/**
 * GET /api/stats
 *
 * Returns live platform stats read directly from Celo Sepolia contracts:
 *   - totalDatabases   — Web3QLFactory.databaseCount()
 *   - totalRecords     — sum of Web3QLTable.totalRecords() across all DBs/tables
 *   - totalTables      — sum of Web3QLDatabase.tableCount() across all DBs
 *   - gasSaved         — estimated gas saved vs deploying individual contracts
 *                        (each DB proxy is ~45k gas cheaper than a fresh deploy)
 *
 * Cached for 60 s via Next.js route segment config so it doesn't hammer the RPC
 * on every page load.
 */

import { NextResponse }  from 'next/server';
import { createPublicClient, http, parseAbi } from 'viem';
import { defineChain }   from 'viem';

export const revalidate = 60; // ISR: refresh every 60 s

// ── Chain + client ─────────────────────────────────────────────────────────────

const celoSepolia = defineChain({
  id: 11142220,
  name: 'Celo Sepolia',
  nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.CELO_RPC_URL ?? 'https://forno.celo-sepolia.celo-testnet.org'] },
  },
});

const client = createPublicClient({ chain: celoSepolia, transport: http() });

// ── Addresses ─────────────────────────────────────────────────────────────────

const FACTORY_ADDRESS = (
  process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? '0x2cfE616062261927fCcC727333d6dD3D5880FDd1'
) as `0x${string}`;

// ── Minimal ABIs ──────────────────────────────────────────────────────────────

const FACTORY_ABI = parseAbi([
  'function databaseCount() view returns (uint256)',
  'function getDatabaseAt(uint256 index) view returns (address)',
]);

const DATABASE_ABI = parseAbi([
  'function tableCount() view returns (uint256)',
  'function listTables() view returns (string[])',
  'function getTable(string name) view returns (address)',
]);

const TABLE_ABI = parseAbi([
  'function totalRecords() view returns (uint256)',
  'event RecordWritten(bytes32 indexed key, address indexed owner, uint256 version, uint256 updatedAt)',
]);

// Typed ABI entry for RecordWritten — lets viem resolve the exact getLogs overload
const RECORD_WRITTEN_EVENT = parseAbi([
  'event RecordWritten(bytes32 indexed key, address indexed owner, uint256 version, uint256 updatedAt)',
])[0];

// ── Gas savings estimate ───────────────────────────────────────────────────────
// Each database proxy saves ~45 000 gas vs a full deploy.
// Each table proxy saves ~40 000 gas vs a full deploy.
// CELO gas price ~0.5 gwei, CELO price ~$1.20.
const GAS_PER_DB_SAVED    = 45_000n;
const GAS_PER_TABLE_SAVED = 40_000n;
const GAS_PRICE_GWEI      = 0.5;    // gwei
const CELO_USD            = 1.20;   // approximate

function estimateGasSavedUSD(dbCount: bigint, tableCount: bigint): number {
  const totalGas   = Number(dbCount) * Number(GAS_PER_DB_SAVED) +
                     Number(tableCount) * Number(GAS_PER_TABLE_SAVED);
  const celoSpent  = (totalGas * GAS_PRICE_GWEI) / 1e9;
  return celoSpent * CELO_USD;
}

function fmtUSD(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000)     return `$${Math.round(usd / 1_000)}k`;
  return `$${Math.round(usd)}`;
}

function fmtCount(n: bigint): string {
  const num = Number(n);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000)     return `${(num / 1_000).toFixed(0)}k+`;
  return num.toLocaleString();
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    // 1. Total databases
    const dbCount = await client.readContract({
      address:      FACTORY_ADDRESS,
      abi:          FACTORY_ABI,
      functionName: 'databaseCount',
    });

    // 2. All database addresses — page through getDatabaseAt(index)
    let dbAddresses: `0x${string}`[] = [];
    try {
      // Cap at 50 to avoid RPC timeouts; enough for stats sampling
      const limit = Number(dbCount) > 50 ? 50 : Number(dbCount);
      dbAddresses = await Promise.all(
        Array.from({ length: limit }, (_, i) =>
          client.readContract({
            address:      FACTORY_ADDRESS,
            abi:          FACTORY_ABI,
            functionName: 'getDatabaseAt',
            args:         [BigInt(i)],
          })
        )
      );
    } catch {
      dbAddresses = [];
    }

    // 3. For each DB: get table count + per-table totalRecords; collect addresses for event scan
    let totalTables  = 0n;
    let totalRecords = 0n;
    const allTableAddresses: `0x${string}`[] = [];

    await Promise.all(dbAddresses.map(async (dbAddr) => {
      try {
        const tableCount = await client.readContract({
          address:      dbAddr,
          abi:          DATABASE_ABI,
          functionName: 'tableCount',
        });
        totalTables += tableCount;

        const tableNames = await client.readContract({
          address:      dbAddr,
          abi:          DATABASE_ABI,
          functionName: 'listTables',
        });

        // Read totalRecords for each table in parallel
        const recordCounts = await Promise.all(
          tableNames.map(async (name) => {
            try {
              const tableAddr = await client.readContract({
                address:      dbAddr,
                abi:          DATABASE_ABI,
                functionName: 'getTable',
                args:         [name],
              });
              if (tableAddr !== '0x0000000000000000000000000000000000000000') {
                allTableAddresses.push(tableAddr);
              }
              return await client.readContract({
                address:      tableAddr,
                abi:          TABLE_ABI,
                functionName: 'totalRecords',
              });
            } catch {
              return 0n;
            }
          })
        );
        for (const c of recordCounts) totalRecords += c;
      } catch {
        // Skip unresponsive contracts
      }
    }));

    // 4. 7-day write activity via RecordWritten events
    // Celo Sepolia blocks every ~5 s → ~17 280 blocks per day
    const BLOCKS_PER_DAY = 17_280n;
    const weeklyActivity: number[] = Array(7).fill(0);
    if (allTableAddresses.length > 0) {
      try {
        const latestBlock = await client.getBlockNumber();
        for (let day = 6; day >= 0; day--) {
          const fromBlock = latestBlock - BigInt(day + 1) * BLOCKS_PER_DAY;
          const toBlock   = latestBlock - BigInt(day) * BLOCKS_PER_DAY;
          const bucketIdx = 6 - day; // 0 = oldest, 6 = today

          // Fan out across table addresses in chunks of 10 to avoid RPC limits
          let dayCount = 0;
          for (let i = 0; i < allTableAddresses.length; i += 10) {
            const chunk = allTableAddresses.slice(i, i + 10);
            const chunkLogs = await Promise.all(
              chunk.map((addr) =>
                client.getLogs({
                  address:   addr,
                  event:     RECORD_WRITTEN_EVENT,
                  fromBlock,
                  toBlock,
                }).catch(() => [])
              )
            );
            for (const logs of chunkLogs) dayCount += logs.length;
          }
          weeklyActivity[bucketIdx] = dayCount;
        }
      } catch { /* leave zeroes */ }
    }

    const gasSavedUSD = estimateGasSavedUSD(dbCount, totalTables);

    return NextResponse.json({
      totalDatabases: Number(dbCount),
      totalTables:    Number(totalTables),
      totalRecords:   Number(totalRecords),
      gasSavedUSD:    Math.round(gasSavedUSD),
      weeklyActivity,                         // [day-6, day-5, …, today]
      // Pre-formatted for the landing page
      formatted: {
        databases: fmtCount(dbCount),
        tables:    fmtCount(totalTables),
        records:   fmtCount(totalRecords),
        gasSaved:  fmtUSD(gasSavedUSD),
      },
    });

  } catch (err) {
    console.error('[/api/stats] RPC error:', err);
    // Return fallback values so the landing page never breaks
    return NextResponse.json(
      {
        totalDatabases: 0,
        totalTables:    0,
        totalRecords:   0,
        gasSavedUSD:    0,
        weeklyActivity: Array(7).fill(0),
        formatted: { databases: '—', tables: '—', records: '—', gasSaved: '—' },
        error: 'chain_unavailable',
      },
      { status: 200 }, // 200 so the UI still renders
    );
  }
}
