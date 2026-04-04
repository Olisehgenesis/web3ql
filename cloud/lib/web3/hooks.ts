'use client'

import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  useReadContracts,
} from 'wagmi'
import {
  FACTORY_ABI,
  FACTORY_ADDRESS,
  DATABASE_ABI,
  TABLE_ABI,
  CHAIN_ID,
  recordKey,
} from '@/lib/contracts'
import { useFactoryAddress } from '@/store'
import { type Address, toHex, fromHex } from 'viem'

// ─── Factory Hooks ────────────────────────────────────────────────────────────

export function useUserDatabases(userAddress?: Address) {
  const factory = useFactoryAddress()
  return useReadContract({
    address: factory,
    abi: FACTORY_ABI,
    functionName: 'getUserDatabases',
    args: userAddress ? [userAddress] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!userAddress },
  })
}

export function useTotalDatabaseCount() {
  const factory = useFactoryAddress()
  return useReadContract({
    address: factory,
    abi: FACTORY_ABI,
    functionName: 'databaseCount',
    chainId: CHAIN_ID,
  })
}

export function useCreateDatabase() {
  const factory = useFactoryAddress()
  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })

  const createDatabase = (name: string) => {
    write.writeContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: 'createDatabase',
      args: [name],
      chainId: CHAIN_ID,
    })
  }

  return { createDatabase, isPending: write.isPending, isSuccess: receipt.isSuccess, isError: write.isError, error: write.error, hash: write.data, receiptData: receipt.data }
}

// ─── Database Hooks ───────────────────────────────────────────────────────────

export function useDatabaseName(dbAddress?: Address) {
  return useReadContract({
    address: dbAddress,
    abi: DATABASE_ABI,
    functionName: 'databaseName',
    chainId: CHAIN_ID,
    query: { enabled: !!dbAddress },
  })
}

export function useDatabaseOwner(dbAddress?: Address) {
  return useReadContract({
    address: dbAddress,
    abi: DATABASE_ABI,
    functionName: 'owner',
    chainId: CHAIN_ID,
    query: { enabled: !!dbAddress },
  })
}

export function useListTables(dbAddress?: Address) {
  return useReadContract({
    address: dbAddress,
    abi: DATABASE_ABI,
    functionName: 'listTables',
    chainId: CHAIN_ID,
    query: { enabled: !!dbAddress },
  })
}

export function useTableCount(dbAddress?: Address) {
  return useReadContract({
    address: dbAddress,
    abi: DATABASE_ABI,
    functionName: 'tableCount',
    chainId: CHAIN_ID,
    query: { enabled: !!dbAddress },
  })
}

export function useGetTableAddress(dbAddress?: Address, tableName?: string) {
  return useReadContract({
    address: dbAddress,
    abi: DATABASE_ABI,
    functionName: 'getTable',
    args: tableName ? [tableName] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!dbAddress && !!tableName },
  })
}

export function useCreateTable() {
  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })

  const createTable = (dbAddress: Address, name: string, schema: string) => {
    const schemaBytes = toHex(new TextEncoder().encode(schema))
    write.writeContract({
      address: dbAddress,
      abi: DATABASE_ABI,
      functionName: 'createTable',
      args: [name, schemaBytes],
      chainId: CHAIN_ID,
    })
  }

  return { createTable, isPending: write.isPending, isSuccess: receipt.isSuccess, isError: write.isError, error: write.error, hash: write.data, receiptData: receipt.data }
}

// ─── Table Hooks ──────────────────────────────────────────────────────────────

export function useTableName(tableAddress?: Address) {
  return useReadContract({
    address: tableAddress,
    abi: TABLE_ABI,
    functionName: 'tableName',
    chainId: CHAIN_ID,
    query: { enabled: !!tableAddress },
  })
}

export function useTableSchema(tableAddress?: Address) {
  const result = useReadContract({
    address: tableAddress,
    abi: TABLE_ABI,
    functionName: 'schemaBytes',
    chainId: CHAIN_ID,
    query: { enabled: !!tableAddress },
  })

  const schema = result.data
    ? (() => {
        try {
          return new TextDecoder().decode(fromHex(result.data as `0x${string}`, 'bytes'))
        } catch {
          return ''
        }
      })()
    : undefined

  return { ...result, schema }
}

export function useActiveRecords(tableAddress?: Address) {
  return useReadContract({
    address: tableAddress,
    abi: TABLE_ABI,
    functionName: 'activeRecords',
    chainId: CHAIN_ID,
    query: { enabled: !!tableAddress },
  })
}

export function useTotalRecords(tableAddress?: Address) {
  return useReadContract({
    address: tableAddress,
    abi: TABLE_ABI,
    functionName: 'totalRecords',
    chainId: CHAIN_ID,
    query: { enabled: !!tableAddress },
  })
}

export function useOwnerRecordCount(tableAddress?: Address, ownerAddress?: Address) {
  return useReadContract({
    address: tableAddress,
    abi: TABLE_ABI,
    functionName: 'ownerRecordCount',
    args: ownerAddress ? [ownerAddress] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!tableAddress && !!ownerAddress },
  })
}

export function useOwnerRecordKeys(
  tableAddress?: Address,
  ownerAddress?: Address,
  start = BigInt(0),
  limit = BigInt(20)
) {
  return useReadContract({
    address: tableAddress,
    abi: TABLE_ABI,
    functionName: 'getOwnerRecords',
    args: ownerAddress ? [ownerAddress, start, limit] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!tableAddress && !!ownerAddress },
  })
}

export function useRecord(tableAddress?: Address, key?: `0x${string}`) {
  return useReadContract({
    address: tableAddress,
    abi: TABLE_ABI,
    functionName: 'read',
    args: key ? [key] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!tableAddress && !!key },
  })
}

export function useRecordExists(tableAddress?: Address, key?: `0x${string}`) {
  return useReadContract({
    address: tableAddress,
    abi: TABLE_ABI,
    functionName: 'recordExists',
    args: key ? [key] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!tableAddress && !!key },
  })
}

export function useRecordCollaborators(tableAddress?: Address, key?: `0x${string}`) {
  return useReadContract({
    address: tableAddress,
    abi: TABLE_ABI,
    functionName: 'getCollaborators',
    args: key ? [key] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!tableAddress && !!key },
  })
}

export function useUserRole(tableAddress?: Address, key?: `0x${string}`, userAddress?: Address) {
  return useReadContract({
    address: tableAddress,
    abi: TABLE_ABI,
    functionName: 'getRole',
    args: key && userAddress ? [key, userAddress] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!tableAddress && !!key && !!userAddress },
  })
}

export function useWriteRecord() {
  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })

  const writeRecord = (
    tableAddress: Address,
    primaryKey: string,
    tableName: string,
    data: string
  ) => {
    const key = recordKey(tableName, primaryKey)
    const ciphertext = toHex(new TextEncoder().encode(data))
    // Demo: store empty encKey to indicate plaintext
    const encryptedKey = toHex(new Uint8Array(0))
    write.writeContract({
      address: tableAddress,
      abi: TABLE_ABI,
      functionName: 'write',
      args: [key, ciphertext, encryptedKey],
      chainId: CHAIN_ID,
    })
  }

  return { writeRecord, isPending: write.isPending, isSuccess: receipt.isSuccess, isError: write.isError, error: write.error, hash: write.data }
}

export function useUpdateRecord() {
  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })

  const updateRecord = (
    tableAddress: Address,
    primaryKey: string,
    tableName: string,
    data: string
  ) => {
    const key = recordKey(tableName, primaryKey)
    const ciphertext = toHex(new TextEncoder().encode(data))
    const encryptedKey = toHex(new Uint8Array(0))
    write.writeContract({
      address: tableAddress,
      abi: TABLE_ABI,
      functionName: 'update',
      args: [key, ciphertext, encryptedKey],
      chainId: CHAIN_ID,
    })
  }

  return { updateRecord, isPending: write.isPending, isSuccess: receipt.isSuccess, isError: write.isError, error: write.error, hash: write.data }
}

export function useDeleteRecord() {
  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })

  const deleteRecord = (tableAddress: Address, primaryKey: string, tableName: string) => {
    const key = recordKey(tableName, primaryKey)
    write.writeContract({
      address: tableAddress,
      abi: TABLE_ABI,
      functionName: 'deleteRecord',
      args: [key],
      chainId: CHAIN_ID,
    })
  }

  // Delete directly by pre-computed bytes32 key (used when we only have the key hash)
  const deleteRecordByKey = (tableAddress: Address, key: `0x${string}`) => {
    write.writeContract({
      address: tableAddress,
      abi: TABLE_ABI,
      functionName: 'deleteRecord',
      args: [key],
      chainId: CHAIN_ID,
    })
  }

  return { deleteRecord, deleteRecordByKey, isPending: write.isPending, isSuccess: receipt.isSuccess, isError: write.isError, error: write.error, hash: write.data }
}

export function useGrantAccess() {
  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })

  const grantAccess = (
    tableAddress: Address,
    primaryKey: string,
    tableName: string,
    user: Address,
    role: number
  ) => {
    const key = recordKey(tableName, primaryKey)
    const encryptedKeyForUser = toHex(new Uint8Array(0))
    write.writeContract({
      address: tableAddress,
      abi: TABLE_ABI,
      functionName: 'grantAccess',
      args: [key, user, role, encryptedKeyForUser],
      chainId: CHAIN_ID,
    })
  }

  return { grantAccess, isPending: write.isPending, isSuccess: receipt.isSuccess, isError: write.isError, error: write.error, hash: write.data }
}

export function useRevokeAccess() {
  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })

  const revokeAccess = (
    tableAddress: Address,
    primaryKey: string,
    tableName: string,
    user: Address
  ) => {
    const key = recordKey(tableName, primaryKey)
    write.writeContract({
      address: tableAddress,
      abi: TABLE_ABI,
      functionName: 'revokeAccess',
      args: [key, user],
      chainId: CHAIN_ID,
    })
  }

  return { revokeAccess, isPending: write.isPending, isSuccess: receipt.isSuccess, isError: write.isError, error: write.error, hash: write.data }
}

// ─── Helper: decode record ciphertext (plaintext demo mode) ──────────────────

export function decodeCiphertext(ciphertext: `0x${string}` | undefined): string {
  if (!ciphertext) return ''
  try {
    return new TextDecoder().decode(fromHex(ciphertext, 'bytes'))
  } catch {
    return ciphertext
  }
}
