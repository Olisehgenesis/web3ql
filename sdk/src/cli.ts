#!/usr/bin/env node
/**
 * @file   cli.ts
 * @notice Web3QL CLI — manage databases, tables, and records from the terminal.
 *
 * Install globally:
 *   npm install -g @web3ql/sdk
 *   web3ql --help
 *
 * Or run via npx:
 *   npx @web3ql/sdk <command>
 *
 * Requires a .env file (or env vars):
 *   PRIVATE_KEY=0x...
 *   RPC_URL=https://...
 *   FACTORY_ADDRESS=0x...
 *   REGISTRY_ADDRESS=0x...
 *
 * ─────────────────────────────────────────────────────────────
 * Commands
 * ─────────────────────────────────────────────────────────────
 *   web3ql db list                     — list your databases
 *   web3ql db create <name>            — create a new database
 *
 *   web3ql table list <dbAddress>      — list tables in a database
 *   web3ql table create <dbAddress> "<SQL>"  — create table from SQL
 *   web3ql table schema <tableAddress> — print schema for a table
 *
 *   web3ql record write <tableAddress> <id> '<json>'  — write a record
 *   web3ql record read  <tableAddress> <id>           — read + decrypt a record
 *   web3ql record list  <tableAddress>                — list your records
 *   web3ql record delete <tableAddress> <id>          — delete a record
 *
 *   web3ql query <tableAddress> --where "age > 18" --order "name asc" --limit 10
 *
 *   web3ql info                        — show connected wallet + factory
 * ─────────────────────────────────────────────────────────────
 */

import { ethers }                     from 'ethers';
import { Web3QLClient }               from './factory-client.js';
import { deriveKeypairFromWallet }    from './crypto.js';

// ─────────────────────────────────────────────────────────────
//  Env + provider setup
// ─────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`\x1b[31mError:\x1b[0m Missing environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

async function setup() {
  // Support .env file via dotenvx if available
  try {
    const { config } = await import('@dotenvx/dotenvx');
    config({ quiet: true });
  } catch { /* no dotenvx installed — rely on process.env */ }

  const privateKey  = requireEnv('PRIVATE_KEY');
  const rpcUrl      = requireEnv('RPC_URL');
  const factory     = requireEnv('FACTORY_ADDRESS');
  const registry    = process.env['REGISTRY_ADDRESS'] ?? '';

  const provider    = new ethers.JsonRpcProvider(rpcUrl);
  const signer      = new ethers.Wallet(privateKey, provider);
  const keypair     = await deriveKeypairFromWallet(signer);
  const client      = new Web3QLClient(factory, signer, keypair, registry);
  const address     = await signer.getAddress();

  return { client, signer, keypair, address, factory, registry };
}

// ─────────────────────────────────────────────────────────────
//  Formatting helpers
// ─────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
};

function head(text: string) {
  console.log(`\n${C.bold}${C.cyan}${text}${C.reset}`);
}
function ok(text: string)   { console.log(`${C.green}✔${C.reset}  ${text}`); }
function info(text: string) { console.log(`${C.dim}${text}${C.reset}`); }
function row(label: string, value: string) {
  console.log(`  ${C.bold}${label.padEnd(16)}${C.reset} ${value}`);
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────
//  Command handlers
// ─────────────────────────────────────────────────────────────

async function cmdInfo() {
  const { address, factory, registry } = await setup();
  head('Web3QL — connection info');
  row('Wallet',   address);
  row('Factory',  factory);
  row('Registry', registry ?? '(not set)');
  console.log();
}

async function cmdDbList() {
  const { client, address } = await setup();
  head('Your databases');
  const dbs = await client.getDatabases(address);
  if (!dbs.length) { info('No databases found.'); return; }
  dbs.forEach((addr: string, i: number) => {
    console.log(`  ${C.cyan}${i + 1}.${C.reset} ${addr}`);
  });
  console.log();
}

async function cmdDbCreate(name: string) {
  const { client } = await setup();
  head(`Creating database: ${name}`);
  const db = await client.createDatabase(name);
  ok(`Deployed! Address: ${db.address}`);
}

async function cmdTableList(dbAddress: string) {
  const { client } = await setup();
  head(`Tables in ${shortAddr(dbAddress)}`);
  const db = client.database(dbAddress);
  const tables: string[] = await db.listTables();
  if (!tables.length) { info('No tables.'); return; }
  tables.forEach((t: string, i: number) => {
    console.log(`  ${C.cyan}${i + 1}.${C.reset} ${t}`);
  });
  console.log();
}

async function cmdTableCreate(dbAddress: string, sql: string) {
  const { client } = await setup();
  head('Creating table');
  info(sql);
  // For CLI, pass empty schemaBytes — user should compile schema separately
  const db      = client.database(dbAddress);
  // Extract table name from SQL for the name param
  const nameMatch = sql.match(/CREATE\s+TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  const tableName = nameMatch?.[1] ?? 'table';
  const addr    = await db.createTable(tableName, '0x');
  ok(`Table created! Address: ${addr}`);
}

async function cmdTableSchema(tableAddress: string) {
  const { client } = await setup();
  const { signer, keypair } = await setup();
  const { EncryptedTableClient } = await import('./table-client.js');
  const table = new EncryptedTableClient(tableAddress, signer, keypair);
  head(`Schema — ${shortAddr(tableAddress)}`);
  try {
    const schemaHex: string = await (table as unknown as { getSchema(): Promise<string> }).getSchema();
    if (!schemaHex || schemaHex === '0x') { info('No schema found.'); return; }
    const bytes  = Buffer.from(schemaHex.slice(2), 'hex');
    console.log(bytes.toString('utf8'));
  } catch {
    info('Schema not available (table may use raw bytes storage).');
  }
}

async function cmdRecordWrite(tableAddress: string, id: bigint, jsonStr: string) {
  const { signer, keypair } = await setup();
  const { EncryptedTableClient } = await import('./table-client.js');
  const table = new EncryptedTableClient(tableAddress, signer, keypair);
  const data  = JSON.parse(jsonStr) as Record<string, unknown>;
  head(`Writing record ${id} → ${shortAddr(tableAddress)}`);
  const key     = table.deriveKey(tableAddress, id);
  const receipt = await table.writeRaw(key, JSON.stringify(data));
  ok(`Written! Tx: ${receipt.hash}`);
}

async function cmdRecordRead(tableAddress: string, id: bigint) {
  const { signer, keypair } = await setup();
  const { EncryptedTableClient } = await import('./table-client.js');
  const table = new EncryptedTableClient(tableAddress, signer, keypair);
  head(`Record ${id} — ${shortAddr(tableAddress)}`);
  try {
    const key       = table.deriveKey(tableAddress, id);
    const plaintext = await table.readPlaintext(key);
    console.log(JSON.stringify(JSON.parse(plaintext), null, 2));
  } catch (e) {
    console.error(`${C.red}Error:${C.reset}`, (e as Error).message);
  }
}

async function cmdRecordList(tableAddress: string, limitN = 20) {
  const { signer, keypair, address } = await setup();
  const { EncryptedTableClient } = await import('./table-client.js');
  const table = new EncryptedTableClient(tableAddress, signer, keypair);
  head(`Records owned by ${shortAddr(address)} in ${shortAddr(tableAddress)}`);
  const keys: string[] = await table.listOwnerRecords(address, 0n, BigInt(limitN));
  if (!keys.length) { info('No records.'); return; }
  for (const key of keys) {
    try {
      const plain: string = await table.readPlaintext(key);
      const parsed        = JSON.parse(plain) as unknown;
      console.log(`\n  ${C.cyan}Key:${C.reset} ${key}`);
      console.log('  ' + JSON.stringify(parsed));
    } catch { /* skip unreadable */ }
  }
  console.log();
}

async function cmdRecordDelete(tableAddress: string, id: bigint) {
  const { signer, keypair } = await setup();
  const { EncryptedTableClient } = await import('./table-client.js');
  const table = new EncryptedTableClient(tableAddress, signer, keypair);
  head(`Deleting record ${id}`);
  const key     = table.deriveKey(tableAddress, id);
  const receipt = await table.deleteRecord(key);
  ok(`Deleted! Tx: ${receipt.hash}`);
}

// ─────────────────────────────────────────────────────────────
//  Help
// ─────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
${C.bold}${C.cyan}Web3QL CLI${C.reset}  — on-chain encrypted database management

${C.bold}USAGE${C.reset}
  web3ql <command> [options]

${C.bold}COMMANDS${C.reset}
  ${C.green}info${C.reset}                                Show wallet + factory info
  ${C.green}db list${C.reset}                             List your databases
  ${C.green}db create <name>${C.reset}                    Deploy a new database
  ${C.green}table list <dbAddress>${C.reset}              List tables in a database
  ${C.green}table create <dbAddress> "<SQL>"${C.reset}    Create a table from SQL
  ${C.green}table schema <tableAddress>${C.reset}         Print table schema
  ${C.green}record write <table> <id> '<json>'${C.reset}  Write an encrypted record
  ${C.green}record read  <table> <id>${C.reset}           Read + decrypt a record
  ${C.green}record list  <table> [limit]${C.reset}        List your records
  ${C.green}record delete <table> <id>${C.reset}          Soft-delete a record

${C.bold}ENV VARS${C.reset}
  PRIVATE_KEY        Ethereum private key (0x...)
  RPC_URL            JSON-RPC endpoint
  FACTORY_ADDRESS    Web3QL factory contract address
  REGISTRY_ADDRESS   Public key registry address (optional)

${C.bold}EXAMPLE${C.reset}
  export PRIVATE_KEY=0xabc...
  export RPC_URL=https://forno.celo.org
  export FACTORY_ADDRESS=0x2cfE...
  web3ql info
  web3ql db create myapp
  web3ql table list 0xDB_ADDR
`);
}

// ─────────────────────────────────────────────────────────────
//  Argument router
// ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cmd  = args[0];

  try {
    if (!cmd || cmd === '--help' || cmd === '-h') {
      printHelp();
      return;
    }

    if (cmd === 'info') {
      await cmdInfo();
      return;
    }

    if (cmd === 'db') {
      const sub = args[1];
      if (sub === 'list') { await cmdDbList(); return; }
      if (sub === 'create') {
        if (!args[2]) { console.error('Usage: web3ql db create <name>'); process.exit(1); }
        await cmdDbCreate(args[2]!);
        return;
      }
    }

    if (cmd === 'table') {
      const sub = args[1];
      if (sub === 'list') {
        if (!args[2]) { console.error('Usage: web3ql table list <dbAddress>'); process.exit(1); }
        await cmdTableList(args[2]!);
        return;
      }
      if (sub === 'create') {
        if (!args[2] || !args[3]) { console.error('Usage: web3ql table create <dbAddress> "<SQL>"'); process.exit(1); }
        await cmdTableCreate(args[2]!, args[3]!);
        return;
      }
      if (sub === 'schema') {
        if (!args[2]) { console.error('Usage: web3ql table schema <tableAddress>'); process.exit(1); }
        await cmdTableSchema(args[2]!);
        return;
      }
    }

    if (cmd === 'record') {
      const sub = args[1];
      if (sub === 'write') {
        if (!args[2] || !args[3] || !args[4]) { console.error('Usage: web3ql record write <table> <id> \'<json>\''); process.exit(1); }
        await cmdRecordWrite(args[2]!, BigInt(args[3]!), args[4]!);
        return;
      }
      if (sub === 'read') {
        if (!args[2] || !args[3]) { console.error('Usage: web3ql record read <table> <id>'); process.exit(1); }
        await cmdRecordRead(args[2]!, BigInt(args[3]!));
        return;
      }
      if (sub === 'list') {
        if (!args[2]) { console.error('Usage: web3ql record list <table> [limit]'); process.exit(1); }
        await cmdRecordList(args[2]!, args[3] ? parseInt(args[3]) : 20);
        return;
      }
      if (sub === 'delete') {
        if (!args[2] || !args[3]) { console.error('Usage: web3ql record delete <table> <id>'); process.exit(1); }
        await cmdRecordDelete(args[2]!, BigInt(args[3]!));
        return;
      }
    }

    console.error(`${C.red}Unknown command:${C.reset} ${cmd}\nRun \`web3ql --help\` for usage.`);
    process.exit(1);
  } catch (err) {
    console.error(`${C.red}Error:${C.reset}`, (err as Error).message);
    process.exit(1);
  }
}

main();
