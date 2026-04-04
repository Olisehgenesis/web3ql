/**
 * @file   walletUtils.js
 * @notice Wallet balance, funding checks, and gas estimation for Web3QL.
 *
 * All RPC calls target the Celo network (mainnet or Sepolia testnet).
 * Set CELO_RPC_URL and CELO_NETWORK env vars to override defaults.
 *
 * CELO_RPC_URL  — JSON-RPC endpoint (default: Alfajores forno)
 * CELO_NETWORK  — "mainnet" | "testnet" (default: "testnet")
 */

import { ethers } from 'ethers';

// ─────────────────────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────────────────────

const CELO_SEPOLIA_RPC = 'https://forno.celo-sepolia.celo-testnet.org'; // Celo Sepolia (chainId 11142220)
const CELO_MAINNET_RPC = 'https://forno.celo.org';

/**
 * Minimum balance required to write a record.
 * 0.01 CELO covers gas for write() + potential SSTORE costs.
 */
const MIN_BALANCE_CELO = '0.01';
const MIN_BALANCE_WEI  = ethers.parseEther(MIN_BALANCE_CELO);

// ─────────────────────────────────────────────────────────────
//  Provider factory
// ─────────────────────────────────────────────────────────────

function getProvider() {
  const rpcUrl = process.env.CELO_RPC_URL
    ?? (process.env.CELO_NETWORK === 'mainnet' ? CELO_MAINNET_RPC : CELO_SEPOLIA_RPC);
  return new ethers.JsonRpcProvider(rpcUrl);
}

// ─────────────────────────────────────────────────────────────
//  getWalletBalance
// ─────────────────────────────────────────────────────────────

/**
 * Fetch the CELO balance of an address.
 *
 * @param {string} address  EVM address (checksummed or lowercase)
 * @returns {Promise<{
 *   address    : string,
 *   balanceWei : string,
 *   balanceCELO: string,
 *   sufficient : boolean,
 * }>}
 */
export async function getWalletBalance(address) {
  if (!ethers.isAddress(address)) {
    throw new Error(`walletUtils.getWalletBalance: invalid address "${address}"`);
  }

  const provider   = getProvider();
  const balanceWei = await provider.getBalance(address);

  return {
    address     : ethers.getAddress(address),           // normalize to checksum
    balanceWei  : balanceWei.toString(),
    balanceCELO : ethers.formatEther(balanceWei),
    sufficient  : balanceWei >= MIN_BALANCE_WEI,
  };
}

// ─────────────────────────────────────────────────────────────
//  estimateWriteCost
// ─────────────────────────────────────────────────────────────

/**
 * Estimate the gas cost of a single write() call for a given data size.
 *
 * Gas model breakdown:
 *   - Base transaction:        21,000
 *   - SSTORE for RecordMeta:  ~5 slots × 20,000 = 100,000
 *   - SSTORE for keys array:  ~20,000
 *   - Calldata (non-zero):    per-byte cost via block base fee
 *   - Encrypted key blob:     125 bytes fixed overhead
 *
 * Note: this is a conservative upper-bound estimate, not a simulation.
 * For a precise estimate on a specific record, call provider.estimateGas()
 * directly using the signer.
 *
 * @param {number} dataBytes  Length in bytes of the plaintext (pre-encryption)
 * @returns {Promise<{
 *   estimatedGas : string,
 *   estimatedCELO: string,
 *   estimatedUSD : string,
 * }>}
 */
export async function estimateWriteCost(dataBytes) {
  if (typeof dataBytes !== 'number' || dataBytes < 0) {
    throw new Error('walletUtils.estimateWriteCost: dataBytes must be a non-negative number');
  }

  const provider = getProvider();
  const feeData  = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
  if (!gasPrice) {
    throw new Error('walletUtils.estimateWriteCost: could not retrieve gas price from provider');
  }

  // AES-GCM adds 28 bytes overhead (12 IV + 16 authTag); encrypted key blob is 125 bytes
  const ciphertextBytes = dataBytes + 28;
  const encryptedKeyBytes = 125;

  // Calldata cost: ~68 gas per non-zero byte (worst-case conservative estimate)
  const calldataBytes  = 32n          // bytes32 key arg
    + 32n                             // ciphertext offset
    + 32n                             // ciphertext length
    + BigInt(ciphertextBytes)
    + 32n                             // encryptedKey offset
    + 32n                             // encryptedKey length
    + BigInt(encryptedKeyBytes);
  const calldataGas    = calldataBytes * 68n;

  const storageGas     = 21_000n + 100_000n + 20_000n; // base + metadata + key slot
  const estimatedGas   = storageGas + calldataGas;

  const estimatedWei   = estimatedGas * gasPrice;
  const estimatedCELO  = ethers.formatEther(estimatedWei);

  // Approximate CELO/USD price — replace with a price oracle in production
  const celoUsdPrice   = Number(process.env.CELO_USD_PRICE ?? '0.58');
  const estimatedUSD   = (parseFloat(estimatedCELO) * celoUsdPrice).toFixed(6);

  return {
    estimatedGas : estimatedGas.toString(),
    estimatedCELO,
    estimatedUSD : `$${estimatedUSD}`,
  };
}

// ─────────────────────────────────────────────────────────────
//  fundingGuide
// ─────────────────────────────────────────────────────────────

/**
 * Return a structured funding guide when a wallet's balance is insufficient.
 *
 * @param {string} address  EVM address to check
 * @returns {Promise<{
 *   address     : string,
 *   required    : string,
 *   current     : string,
 *   sufficient  : boolean,
 *   message     : string,
 *   instructions: string,
 *   faucet?     : string,
 * }>}
 */
export async function fundingGuide(address) {
  if (!ethers.isAddress(address)) {
    throw new Error(`walletUtils.fundingGuide: invalid address "${address}"`);
  }

  const { balanceCELO, sufficient } = await getWalletBalance(address);
  const isTestnet = (process.env.CELO_NETWORK ?? 'testnet') !== 'mainnet';
  const normalized = ethers.getAddress(address);

  const guide = {
    address     : normalized,
    required    : `${MIN_BALANCE_CELO} CELO`,
    current     : `${balanceCELO} CELO`,
    sufficient,
    message     : sufficient
      ? 'Wallet has sufficient balance for write operations.'
      : 'Wallet balance is below the minimum required to write records on-chain.',
    instructions: isTestnet
      ? `1. Visit https://faucet.celo.org\n2. Paste your address: ${normalized}\n3. Request test CELO (takes ~5 seconds)`
      : `Send at least ${MIN_BALANCE_CELO} CELO to ${normalized} from a funded wallet.`,
  };

  if (isTestnet) {
    guide.faucet = 'https://faucet.celo.org';
  }

  return guide;
}

// ─────────────────────────────────────────────────────────────
//  requireSufficientBalance (convenience guard used by connector)
// ─────────────────────────────────────────────────────────────

/**
 * Throws a structured funding error if the address lacks minimum balance.
 * Used as a preflight guard in write / update endpoints.
 *
 * @param {string} address
 * @throws {{ code: 'INSUFFICIENT_BALANCE', fundingGuide: object }}
 */
export async function requireSufficientBalance(address) {
  const balance = await getWalletBalance(address);
  if (!balance.sufficient) {
    const guide = await fundingGuide(address);
    const err   = new Error(`Insufficient balance: ${balance.balanceCELO} CELO (need ${MIN_BALANCE_CELO})`);
    err.code    = 'INSUFFICIENT_BALANCE';
    err.fundingGuide = guide;
    throw err;
  }
}
