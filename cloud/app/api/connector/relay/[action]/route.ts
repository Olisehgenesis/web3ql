export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/connector/relay/[action]
 *
 * Actions:
 *   register-wallet  — prove wallet ownership, add to relay allowlist
 *   write            — sponsored write (relay pays gas) — requires X-Api-Key
 *   update           — sponsored update                 — requires X-Api-Key
 *   delete           — sponsored delete                 — requires X-Api-Key
 *   submit-intent    — gasless EIP-712 signed intent    — no API key; wallet allowlist is auth
 */
import { type NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { errJson, requireFields, checkRateLimit, deriveRecordKey, TABLE_ABI } from '@/lib/connector/core'
import {
  _allowedWallets,
  checkRelayApiKey,
  checkWalletAllowed,
  getRelayWallet,
  getRelayX25519Keypair,
  checkAndMarkNonce,
  getChainId,
} from '@/lib/connector/relay'

type Params = { action: string }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const rl = checkRateLimit(req)
  if (rl) return rl

  const { action } = await params
  const body: Record<string, any> = await req.json().catch(() => ({}))

  try {
    switch (action) {
      case 'register-wallet': return registerWallet(body)
      case 'write':           return relayWrite(req, body)
      case 'update':          return relayUpdate(req, body)
      case 'delete':          return relayDelete(req, body)
      case 'submit-intent':   return submitIntent(body)
      default:
        return errJson(404, `Unknown relay action: ${action}`, 'NOT_FOUND')
    }
  } catch (err: any) {
    return errJson(err.status ?? 500, err.message, err.code ?? 'RELAY_FAILED')
  }
}

// ── register-wallet ───────────────────────────────────────────────────────────

function registerWallet(body: Record<string, any>): NextResponse {
  requireFields(body, ['walletAddress', 'signature'])
  const { walletAddress, signature } = body

  if (!ethers.isAddress(walletAddress)) return errJson(400, 'Invalid walletAddress', 'INVALID_ADDRESS')

  const message   = `Register wallet for Web3QL relay: ${walletAddress.toLowerCase()}`
  const recovered = ethers.verifyMessage(message, signature)

  if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
    return errJson(
      401,
      `Signature mismatch: expected ${walletAddress}, got ${recovered}`,
      'INVALID_SIGNATURE',
    )
  }

  _allowedWallets.add(walletAddress.toLowerCase())

  return NextResponse.json({
    success      : true,
    walletAddress: ethers.getAddress(walletAddress),
    message      : `Wallet ${walletAddress} registered for signed intents. ` +
                   'Add it to RELAY_ALLOWED_WALLETS env to persist across restarts.',
  })
}

// ── relay/write ───────────────────────────────────────────────────────────────

async function relayWrite(req: NextRequest, body: Record<string, any>): Promise<NextResponse> {
  const authErr = checkRelayApiKey(req)
  if (authErr) return authErr

  const wallet = getRelayWallet()
  if (!wallet) return errJson(501, 'Relay wallet not configured (RELAY_PRIVATE_KEY not set)', 'RELAY_NOT_CONFIGURED')

  requireFields(body, ['tableAddress', 'tableName', 'recordId', 'ciphertext', 'encryptedKeyForRelay'])
  const {
    tableAddress, tableName, recordId,
    ciphertext, encryptedKeyForRelay,
    userAddress, encryptedKeyForUser,
    userRole = 1,
    gasLimit,
  } = body

  if (!ethers.isAddress(tableAddress))                              return errJson(400, 'Invalid tableAddress',  'INVALID_ADDRESS')
  if (userAddress && !ethers.isAddress(userAddress))               return errJson(400, 'Invalid userAddress',   'INVALID_ADDRESS')
  if (userAddress && !encryptedKeyForUser)                         return errJson(400, 'encryptedKeyForUser required when userAddress is set', 'MISSING_FIELDS')
  if (userRole !== undefined && ![1, 2].includes(Number(userRole))) return errJson(400, 'userRole must be 1 or 2', 'INVALID_ROLE')

  const iface     = new ethers.Interface(TABLE_ABI)
  const recordKey = deriveRecordKey(tableName, recordId)

  const target    = ethers.getAddress(tableAddress)
  const provider  = wallet.provider as ethers.JsonRpcProvider
  const writeData = iface.encodeFunctionData('write', [recordKey, ciphertext, encryptedKeyForRelay])

  // Simulate to surface revert reasons before spending gas
  try {
    await provider.call({ to: target, from: wallet.address, data: writeData })
  } catch (simErr: any) {
    const reason = simErr.reason ?? simErr.shortMessage ?? simErr.message ?? 'unknown revert'
    return errJson(400, `Write would revert: ${reason}`, 'WRITE_SIMULATION_FAILED')
  }

  let writeGasLimit: bigint
  try {
    const est = await provider.estimateGas({ to: target, from: wallet.address, data: writeData })
    writeGasLimit = gasLimit ? BigInt(gasLimit) : (est * 130n) / 100n
  } catch {
    writeGasLimit = gasLimit ? BigInt(gasLimit) : 600_000n
  }

  const writeTx = await wallet.sendTransaction({ to: target, data: writeData, gasLimit: writeGasLimit })
  await writeTx.wait()

  let grantTxHash: string | null = null
  if (userAddress && encryptedKeyForUser) {
    const grantData = iface.encodeFunctionData('grantAccess', [recordKey, userAddress, Number(userRole), encryptedKeyForUser])
    let grantGasLimit: bigint
    try {
      const est = await provider.estimateGas({ to: target, from: wallet.address, data: grantData })
      grantGasLimit = (est * 130n) / 100n
    } catch {
      grantGasLimit = 200_000n
    }
    const grantTx = await wallet.sendTransaction({ to: target, data: grantData, gasLimit: grantGasLimit })
    await grantTx.wait()
    grantTxHash = grantTx.hash
  }

  return NextResponse.json({
    success     : true,
    txHash      : writeTx.hash,
    grantTxHash,
    recordKey,
    relayAddress: wallet.address,
  })
}

// ── relay/update ──────────────────────────────────────────────────────────────

async function relayUpdate(req: NextRequest, body: Record<string, any>): Promise<NextResponse> {
  const authErr = checkRelayApiKey(req)
  if (authErr) return authErr

  const wallet = getRelayWallet()
  if (!wallet) return errJson(501, 'Relay wallet not configured (RELAY_PRIVATE_KEY not set)', 'RELAY_NOT_CONFIGURED')

  requireFields(body, ['tableAddress', 'tableName', 'recordId', 'ciphertext', 'encryptedKey'])
  const { tableAddress, tableName, recordId, ciphertext, encryptedKey, gasLimit } = body

  if (!ethers.isAddress(tableAddress)) return errJson(400, 'Invalid tableAddress', 'INVALID_ADDRESS')

  const iface     = new ethers.Interface(TABLE_ABI)
  const recordKey = deriveRecordKey(tableName, recordId)
  const target    = ethers.getAddress(tableAddress)
  const updateData = iface.encodeFunctionData('update', [recordKey, ciphertext, encryptedKey])

  // Simulate first for early revert detection
  const provider = wallet.provider!
  try { await provider.call({ to: target, from: wallet.address, data: updateData }) }
  catch (simErr: any) {
    const reason = simErr.reason ?? simErr.message ?? 'unknown'
    return errJson(400, `Update would revert: ${reason}`, 'UPDATE_SIMULATION_FAILED')
  }

  let updateGasLimit: bigint
  try {
    const est = await provider.estimateGas({ to: target, from: wallet.address, data: updateData })
    updateGasLimit = gasLimit ? BigInt(gasLimit) : (est * 130n) / 100n
  } catch {
    updateGasLimit = gasLimit ? BigInt(gasLimit) : 600_000n
  }

  const tx = await wallet.sendTransaction({ to: target, data: updateData, gasLimit: updateGasLimit })
  await tx.wait()

  return NextResponse.json({ success: true, txHash: tx.hash, recordKey })
}

// ── relay/delete ──────────────────────────────────────────────────────────────

async function relayDelete(req: NextRequest, body: Record<string, any>): Promise<NextResponse> {
  const authErr = checkRelayApiKey(req)
  if (authErr) return authErr

  const wallet = getRelayWallet()
  if (!wallet) return errJson(501, 'Relay wallet not configured (RELAY_PRIVATE_KEY not set)', 'RELAY_NOT_CONFIGURED')

  requireFields(body, ['tableAddress', 'tableName', 'recordId'])
  const { tableAddress, tableName, recordId, gasLimit } = body

  if (!ethers.isAddress(tableAddress)) return errJson(400, 'Invalid tableAddress', 'INVALID_ADDRESS')

  const iface     = new ethers.Interface(TABLE_ABI)
  const recordKey = deriveRecordKey(tableName, recordId)

  const tx = await wallet.sendTransaction({
    to      : ethers.getAddress(tableAddress),
    data    : iface.encodeFunctionData('deleteRecord', [recordKey]),
    gasLimit: gasLimit ?? 200_000,
  })
  await tx.wait()

  return NextResponse.json({ success: true, txHash: tx.hash, recordKey })
}

// ── submit-intent ─────────────────────────────────────────────────────────────

async function submitIntent(body: Record<string, any>): Promise<NextResponse> {
  const wallet  = getRelayWallet()
  const keypair = getRelayX25519Keypair()
  if (!wallet || !keypair) {
    return errJson(501, 'Relay wallet not configured (RELAY_PRIVATE_KEY not set)', 'RELAY_NOT_CONFIGURED')
  }

  requireFields(body, [
    'tableAddress', 'tableName', 'recordId',
    'ciphertext', 'encryptedKeyForRelay', 'encryptedKeyForUser',
    'userAddress', 'signature', 'deadline', 'nonce',
  ])

  const {
    tableAddress, tableName, recordId,
    ciphertext, encryptedKeyForRelay, encryptedKeyForUser,
    userAddress, signature, deadline, nonce,
    userRole = 1,
  } = body

  if (!ethers.isAddress(tableAddress)) return errJson(400, 'Invalid tableAddress', 'INVALID_ADDRESS')
  if (!ethers.isAddress(userAddress))  return errJson(400, 'Invalid userAddress',  'INVALID_ADDRESS')
  if (![1, 2].includes(Number(userRole))) return errJson(400, 'userRole must be 1 (VIEWER) or 2 (EDITOR)', 'INVALID_ROLE')

  if (Math.floor(Date.now() / 1000) > Number(deadline)) {
    return errJson(400, 'Intent expired — deadline has passed', 'INTENT_EXPIRED')
  }

  if (!checkAndMarkNonce(userAddress, nonce)) {
    return errJson(400, 'Nonce already used — this intent was already executed', 'NONCE_REPLAYED')
  }

  // Verify EIP-712 signature
  const ciphertextHash = ethers.keccak256(ciphertext)
  const chainId        = await getChainId()
  const domain         = { name: 'Web3QL Relay', version: '1', chainId }
  const types          = {
    RelayIntent: [
      { name: 'tableAddress',   type: 'address' },
      { name: 'tableName',      type: 'string'  },
      { name: 'recordId',       type: 'uint256' },
      { name: 'ciphertextHash', type: 'bytes32' },
      { name: 'deadline',       type: 'uint256' },
      { name: 'nonce',          type: 'uint256' },
    ],
  }
  const value = {
    tableAddress,
    tableName,
    recordId     : BigInt(recordId),
    ciphertextHash,
    deadline     : BigInt(deadline),
    nonce        : BigInt(nonce),
  }

  const recovered = ethers.verifyTypedData(domain, types, value, signature)
  if (recovered.toLowerCase() !== userAddress.toLowerCase()) {
    return errJson(
      401,
      `Signature mismatch: expected ${userAddress}, recovered ${recovered}`,
      'INVALID_SIGNATURE',
    )
  }

  // Wallet allowlist check
  const blocked = checkWalletAllowed(userAddress)
  if (blocked) return blocked

  // Execute: relay wallet writes the record and grants user read-back access
  const iface     = new ethers.Interface(TABLE_ABI)
  const recordKey = deriveRecordKey(tableName, recordId)
  const provider  = wallet.provider as ethers.JsonRpcProvider
  const target    = ethers.getAddress(tableAddress)

  const writeData = iface.encodeFunctionData('write', [recordKey, ciphertext, encryptedKeyForRelay])

  // Simulate first so reverts produce a readable reason instead of silent OOG
  try {
    await provider.call({ to: target, from: wallet.address, data: writeData })
  } catch (simErr: any) {
    const reason = simErr.reason ?? simErr.shortMessage ?? simErr.message ?? 'unknown revert'
    return errJson(400, `Write would revert: ${reason}`, 'WRITE_SIMULATION_FAILED')
  }

  // Dynamic gas estimate with 1.3× buffer — UUPS proxy + large bytes storage needs >300k
  let writeGasLimit: bigint
  try {
    const est = await provider.estimateGas({ to: target, from: wallet.address, data: writeData })
    writeGasLimit = (est * 130n) / 100n
  } catch {
    writeGasLimit = 600_000n
  }

  const writeTx = await wallet.sendTransaction({ to: target, data: writeData, gasLimit: writeGasLimit })
  await writeTx.wait()

  const grantData = iface.encodeFunctionData('grantAccess', [recordKey, userAddress, Number(userRole), encryptedKeyForUser])
  let grantGasLimit: bigint
  try {
    const est = await provider.estimateGas({ to: target, from: wallet.address, data: grantData })
    grantGasLimit = (est * 130n) / 100n
  } catch {
    grantGasLimit = 200_000n
  }

  const grantTx = await wallet.sendTransaction({ to: target, data: grantData, gasLimit: grantGasLimit })
  await grantTx.wait()

  // Optional: fire-and-forget audit log to RELAY_LAYER_TABLE_ADDRESS
  if (process.env.RELAY_LAYER_TABLE_ADDRESS && process.env.RELAY_LAYER_TABLE_NAME) {
    const sessionId  = BigInt('0x' + writeTx.hash.slice(2, 18))
    const sessionKey = deriveRecordKey(process.env.RELAY_LAYER_TABLE_NAME, sessionId)
    const sessionJson = JSON.stringify({
      userAddress, tableAddress, tableName, recordId,
      txHash: writeTx.hash, grantTxHash: grantTx.hash,
      timestamp: new Date().toISOString(),
    })
    wallet.sendTransaction({
      to      : ethers.getAddress(process.env.RELAY_LAYER_TABLE_ADDRESS),
      data    : iface.encodeFunctionData('write', [
        sessionKey,
        '0x' + Buffer.from(sessionJson).toString('hex'),
        '0x00',
      ]),
      gasLimit: 300_000,
    }).catch(() => { /* ignore audit log failures */ })
  }

  return NextResponse.json({
    success     : true,
    txHash      : writeTx.hash,
    grantTxHash : grantTx.hash,
    recordKey,
    userAddress,
    relayAddress: wallet.address,
  })
}
