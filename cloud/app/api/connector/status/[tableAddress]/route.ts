export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/connector/status/[tableAddress]
 *
 * Return contract metadata for a deployed table.
 * Pure read — no auth, no signing required.
 *
 * Returns: { success, tableAddress, tableName, owner, totalRecords, activeRecords }
 */
import { type NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { getProvider, errJson, checkRateLimit, TABLE_ABI } from '@/lib/connector/core'

type Params = { tableAddress: string }

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const rl = checkRateLimit(req)
  if (rl) return rl

  try {
    const { tableAddress } = await params

    if (!ethers.isAddress(tableAddress)) {
      return errJson(400, 'Invalid tableAddress', 'INVALID_ADDRESS')
    }

    const provider = getProvider()
    const contract = new ethers.Contract(tableAddress, TABLE_ABI, provider)

    const [name, owner, totalRecords, activeRecords] = await Promise.all([
      contract.tableName(),
      contract.owner(),
      contract.totalRecords(),
      contract.activeRecords(),
    ])

    return NextResponse.json({
      success      : true,
      tableAddress : ethers.getAddress(tableAddress),
      tableName    : name,
      owner,
      totalRecords : totalRecords.toString(),
      activeRecords: activeRecords.toString(),
    })
  } catch (err: any) {
    return errJson(err.status ?? 500, err.message, err.code ?? 'STATUS_FAILED')
  }
}
