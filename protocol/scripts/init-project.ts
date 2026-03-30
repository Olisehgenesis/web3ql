#!/usr/bin/env node
/**
 * @file   init-project.ts  (compiled → init-project.js for npx)
 * @notice CLI: npx create-web3ql-app <project-name>
 *
 * Creates a fully wired Web3QL project with:
 *   /contracts      generated Solidity lands here
 *   /sdk            auto-generated TypeScript bindings
 *   schema.sql      user defines their data model here
 *   deploy.ts       deployment script
 *   web3ql.config.json
 *   .env.example
 *   .gitignore
 *   package.json
 *   tsconfig.json
 *   README.md
 */

import * as fs   from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
function write(p: string, content: string) {
  fs.writeFileSync(p, content, 'utf8');
}

// ─────────────────────────────────────────────────────────────
//  File templates
// ─────────────────────────────────────────────────────────────

const SCHEMA_SQL = `\
-- Web3QL example schema
-- Supported types: INT, TEXT, BOOL, ADDRESS, FLOAT
-- PRIMARY KEY must be INT (v1)

CREATE TABLE users (
  id      INT  PRIMARY KEY,
  name    TEXT,
  balance INT
);

CREATE TABLE posts (
  id      INT  PRIMARY KEY,
  title   TEXT,
  content TEXT
);
`;

function CONFIG_JSON(name: string) {
  return JSON.stringify({
    projectName    : name,
    network        : 'celo',
    rpc            : 'https://forno.celo.org',
    celoSepoliaRpc : 'https://forno.celo-sepolia.celo-testnet.org',
    factoryAddress : '0x0000000000000000000000000000000000000000',
    privateKey     : '${PRIVATE_KEY}',
  }, null, 2);
}

const DEPLOY_TS = `\
/**
 * deploy.ts — Web3QL deployment script
 *
 * Flow:
 *   1. Read schema.sql
 *   2. Compile → Solidity + ABI + SDK bindings
 *   3. Create a database via Web3QLFactory.createDatabase()
 *   4. Deploy each compiled table via Web3QLDatabase.createTable()
 *   5. Save deployed addresses to web3ql.config.json
 *   6. Write generated SDK bindings to /sdk/
 */
import * as fs   from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import { compileSchema } from '@web3ql/compiler';
import '@dotenvx/dotenvx/config';

const cfg = JSON.parse(fs.readFileSync('web3ql.config.json', 'utf8'));

const FACTORY_ABI = [
  'function createDatabase() external returns (address)',
  'event DatabaseCreated(address indexed owner, address indexed db, uint256 indexed index)',
];

const DATABASE_ABI = [
  'function createTable(string calldata name, bytes calldata schemaBytes) external returns (address)',
  'event TableCreated(string indexed name, address tableContract, address indexed owner)',
];

async function main() {
  const schema  = fs.readFileSync('schema.sql', 'utf8');
  const outputs = compileSchema(schema);
  console.log(\`Compiled \${outputs.length} table(s): \${outputs.map((o) => o.contractName).join(', ')}\`);

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('PRIVATE_KEY not set in .env');

  const provider = new ethers.JsonRpcProvider(cfg.rpc);
  const wallet   = new ethers.Wallet(privateKey, provider);
  const net      = await provider.getNetwork();
  console.log(\`Connected: chainId \${net.chainId}\`);

  // ── 1. Create database via factory ────────────────────────────
  console.log('Creating database …');
  const factory  = new ethers.Contract(cfg.factoryAddress, FACTORY_ABI, wallet);
  const dbTx     = await factory.createDatabase();
  const dbReceipt = await dbTx.wait();

  const dbCreatedLog = dbReceipt.logs.find(
    (l: any) => l.fragment?.name === 'DatabaseCreated'
  );
  const dbAddress = dbCreatedLog?.args[1] as string;
  console.log(\`  Database deployed: \${dbAddress}\`);

  // ── 2. Deploy each table ───────────────────────────────────────
  const database = new ethers.Contract(dbAddress, DATABASE_ABI, wallet);
  const deployed: Record<string, string> = {};

  for (const output of outputs) {
    // Write generated Solidity
    fs.writeFileSync(
      path.join('contracts', output.contractName + '.sol'),
      output.solidity
    );
    // Write SDK bindings
    fs.writeFileSync(
      path.join('sdk', output.contractName + 'Client.ts'),
      output.sdkBindings
    );

    console.log(\`Deploying table \${output.ast.table} …\`);
    const tableTx      = await database.createTable(output.ast.table, output.schemaBytes);
    const tableReceipt = await tableTx.wait();

    const tableLog = tableReceipt.logs.find(
      (l: any) => l.fragment?.name === 'TableCreated'
    );
    const tableAddress = tableLog?.args[1] as string;
    console.log(\`  Table "\${output.ast.table}": \${tableAddress}\`);
    deployed[output.ast.table] = tableAddress;
  }

  // ── 3. Save addresses ─────────────────────────────────────────
  cfg.deployed = {
    databaseAddress: dbAddress,
    tables         : deployed,
    deployedAt     : new Date().toISOString(),
    chainId        : Number(net.chainId),
  };
  fs.writeFileSync('web3ql.config.json', JSON.stringify(cfg, null, 2));
  console.log('\\nDeployed addresses saved to web3ql.config.json');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
`;

function README(name: string) {
  return `\
# ${name}

A Web3QL project — encrypted on-chain databases via SQL-like schemas.

## Quickstart

\`\`\`bash
cp .env.example .env          # add your PRIVATE_KEY
npm install
npx hardhat compile           # optional — compiles Solidity
npx ts-node deploy.ts         # deploy to Celo
\`\`\`

## Workflow

1. Edit \`schema.sql\` to define your data model.
2. Run \`npx ts-node deploy.ts\` to compile + deploy.
3. Use the generated \`/sdk/*Client.ts\` files in your application.

## Encryption model

\`\`\`
Write:
  dataKey       = crypto.randomBytes(32)           // per-record sym key
  ciphertext    = AES256.encrypt(data, dataKey)
  encryptedKey  = ECIES.encrypt(dataKey, userPubKey)
  → contract.insert(id, ciphertext, encryptedKey)

Read:
  { ciphertext, _ } = contract.readRecord(id)
  encryptedKey       = contract.getMyEncryptedKey(id)
  dataKey            = ECIES.decrypt(encryptedKey, userPrivKey)
  data               = AES256.decrypt(ciphertext, dataKey)

Share:
  dataKey            = ECIES.decrypt(myEncKey, myPrivKey)
  theirEncKey        = ECIES.encrypt(dataKey, theirPubKey)
  → contract.grantRecordAccess(id, theirAddr, VIEWER, theirEncKey)
\`\`\`

## Project structure

\`\`\`
contracts/        Generated Solidity (do not edit)
sdk/              Generated TypeScript SDK bindings
schema.sql        Your data model
deploy.ts         Deployment script
web3ql.config.json Config + deployed addresses
\`\`\`
`;
}

const ENV_EXAMPLE = `\
# Deployer private key (0x prefixed)
PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000

# RPC (defaults to Celo mainnet if not set)
RPC_URL=https://forno.celo.org

# Celoscan API key (for contract verification)
CELOSCAN_API_KEY=
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target         : 'ES2022',
    module         : 'Node16',
    moduleResolution: 'Node16',
    outDir         : 'dist',
    rootDir        : '.',
    strict         : true,
    esModuleInterop: true,
    skipLibCheck   : true,
    resolveJsonModule: true,
  },
  include: ['./**/*.ts'],
  exclude: ['node_modules', 'dist'],
}, null, 2);

function PKG_JSON(name: string) {
  return JSON.stringify({
    name,
    version    : '0.1.0',
    private    : true,
    type       : 'module',
    scripts    : {
      deploy   : 'npx ts-node deploy.ts',
      compile  : 'npx tsc',
    },
    dependencies: {
      '@web3ql/compiler'  : '*',
      ethers              : '^6.0.0',
      '@dotenvx/dotenvx'  : '^1.0.0',
    },
    devDependencies: {
      typescript  : '^5.0.0',
      'ts-node'   : '^10.9.0',
      '@types/node': '^20.0.0',
    },
  }, null, 2);
}

// ─────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────

function main() {
  const name = process.argv[2];
  if (!name) {
    console.error('Usage: npx create-web3ql-app <project-name>');
    process.exit(1);
  }

  const root = path.resolve(process.cwd(), name);
  if (fs.existsSync(root)) {
    console.error(`Directory already exists: ${root}`);
    process.exit(1);
  }

  ensureDir(root);
  ensureDir(path.join(root, 'contracts'));
  ensureDir(path.join(root, 'sdk'));

  write(path.join(root, 'schema.sql'),          SCHEMA_SQL);
  write(path.join(root, 'web3ql.config.json'),  CONFIG_JSON(name));
  write(path.join(root, 'deploy.ts'),            DEPLOY_TS);
  write(path.join(root, 'README.md'),            README(name));
  write(path.join(root, '.env.example'),         ENV_EXAMPLE);
  write(path.join(root, 'tsconfig.json'),        TSCONFIG);
  write(path.join(root, 'package.json'),         PKG_JSON(name));
  write(path.join(root, '.gitignore'), [
    'node_modules/',
    'dist/',
    '.env',
    'web3ql.config.json',  // contains deployed addresses + private key ref
  ].join('\n') + '\n');

  console.log(`\nCreated Web3QL project: ${root}`);
  console.log('\nNext steps:');
  console.log(`  cd ${name}`);
  console.log('  npm install');
  console.log('  cp .env.example .env   # add your PRIVATE_KEY');
  console.log('  npx dotenvx encrypt     # encrypt .env before committing (optional)');
  console.log('  npx ts-node deploy.ts\n');

  try {
    console.log('Installing dependencies …');
    execSync('npm install', { cwd: root, stdio: 'inherit' });
    console.log('\nDone! Your Web3QL project is ready.');
  } catch {
    console.warn('\nnpm install failed — run it manually inside the project folder.');
  }
}

main();
