/**
 * @file   deploy-all.ts
 * @notice Full Web3QL protocol deployment in one script.
 *
 *         Runs in order — each step receives addresses from the previous:
 *           1. Deploy Web3QLTable + Web3QLDatabase impls + Web3QLFactory proxy + PublicKeyRegistry proxy
 *           2. Deploy "cloud" database via the fresh factory
 *           3. Deploy RelationWire (OPTIONAL — skipped if neither WIRE_CONFIG nor
 *              HARDCODED_WIRE_CONFIG.sourceTable is set)
 *
 *         Writes one combined deployment JSON at the end.
 *
 * Usage:
 *   pnpm deploy:all           ← Celo Sepolia
 *   pnpm deploy:all:celo      ← Celo mainnet
 *
 * Wire config (optional — step 3 is silently skipped if omitted):
 *   WIRE_CONFIG='{"sourceTable":"0x...","targetTable":"0x...","fields":["tip_total","tip_count"],...}'
 *   npx hardhat run scripts/deploy-all.ts --network celoSepolia
 *
 * Or hard-code HARDCODED_WIRE_CONFIG below for quick iteration.
 */

import { ethers, upgrades } from 'hardhat';
import * as fs   from 'fs';
import * as path from 'path';

// ─── Optional wire config ──────────────────────────────────────────────────
// Leave sourceTable / targetTable empty to skip wire deployment.
const HARDCODED_WIRE_CONFIG = {
  sourceTable   : '',   // fill to deploy wire as part of deploy:all
  targetTable   : '',
  allowedTokens : [{ token: 'native', minAmount: '0', maxAmount: '0' }],
  fields        : ['tip_total', 'tip_count'],
  usePayment    : [true, false],
  fixedAmounts  : ['0', '1'],
  oncePerAddress: false,
  feeRecipient  : ethers.ZeroAddress,
  feeBps        : 0,
};

// ─── Helpers ───────────────────────────────────────────────────────────────
const ZERO = '0x0000000000000000000000000000000000000000';

function pad(label: string) { return label.padEnd(22); }

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();
  const networkLabel = network.name === 'unknown'
    ? `chain_${network.chainId}`
    : network.name;

  const timestamp    = new Date().toISOString();
  const datePart     = timestamp.slice(0, 10);

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Web3QL — Full Protocol Deployment               ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`  Network  : ${networkLabel} (chainId ${network.chainId})`);
  console.log(`  Deployer : ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance  : ${ethers.formatEther(balance)} CELO\n`);

  // ─────────────────────────────────────────────────────────────
  //  Step 1 — Factory + Registry
  // ─────────────────────────────────────────────────────────────
  console.log('── Step 1: Deploy Factory + Registry ───────────────');

  const TableImpl = await ethers.getContractFactory('Web3QLTable');
  const tableImpl = await TableImpl.deploy();
  await tableImpl.waitForDeployment();
  const tableImplAddress = await tableImpl.getAddress();
  console.log(`  ${pad('Table impl')}  : ${tableImplAddress}`);

  const DatabaseImpl = await ethers.getContractFactory('Web3QLDatabase');
  const databaseImpl = await DatabaseImpl.deploy();
  await databaseImpl.waitForDeployment();
  const databaseImplAddress = await databaseImpl.getAddress();
  console.log(`  ${pad('Database impl')}  : ${databaseImplAddress}`);

  const FactoryF  = await ethers.getContractFactory('Web3QLFactory');
  const factory   = await upgrades.deployProxy(
    FactoryF,
    [deployer.address, databaseImplAddress, tableImplAddress],
    { kind: 'uups', initializer: 'initialize' },
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`  ${pad('Factory proxy')}  : ${factoryAddress}`);

  const RegistryF  = await ethers.getContractFactory('PublicKeyRegistry');
  const registry   = await upgrades.deployProxy(
    RegistryF,
    [deployer.address],
    { kind: 'uups', initializer: 'initialize' },
  );
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`  ${pad('Registry proxy')}  : ${registryAddress}`);

  // ─────────────────────────────────────────────────────────────
  //  Step 2 — Cloud database
  // ─────────────────────────────────────────────────────────────
  console.log('\n── Step 2: Deploy Cloud Database ────────────────────');

  const factoryContract = await ethers.getContractAt('Web3QLFactory', factoryAddress, deployer);
  const dbTx     = await factoryContract.createDatabase('cloud');
  console.log(`  tx hash  : ${dbTx.hash}`);
  const dbReceipt = await dbTx.wait();

  let cloudDbAddress = '';
  for (const log of dbReceipt!.logs) {
    try {
      const parsed = factoryContract.interface.parseLog(log);
      if (parsed?.name === 'DatabaseCreated') {
        cloudDbAddress = parsed.args.db as string;
        break;
      }
    } catch { /* skip */ }
  }
  if (!cloudDbAddress) throw new Error('DatabaseCreated event not found.');
  console.log(`  ${pad('Cloud DB')}  : ${cloudDbAddress}`);

  // ─────────────────────────────────────────────────────────────
  //  Step 3 — RelationWire (optional)
  // ─────────────────────────────────────────────────────────────
  let wireCfg = { ...HARDCODED_WIRE_CONFIG };
  if (process.env.WIRE_CONFIG) {
    try { wireCfg = { ...wireCfg, ...JSON.parse(process.env.WIRE_CONFIG) }; }
    catch (e) { throw new Error(`WIRE_CONFIG is not valid JSON: ${e}`); }
  }

  let wireAddress = '';

  const hasWireCfg = wireCfg.sourceTable && ethers.isAddress(wireCfg.sourceTable)
    && wireCfg.targetTable && ethers.isAddress(wireCfg.targetTable);

  if (hasWireCfg) {
    console.log('\n── Step 3: Deploy RelationWire ──────────────────────');

    const cfgTokens = wireCfg.allowedTokens;
    const allowedTokenAddrs = cfgTokens.map((t) =>
      t.token === 'native' || t.token === ZERO ? ZERO : t.token
    );
    const minAmounts   = cfgTokens.map((t) => BigInt(t.minAmount));
    const maxAmounts   = cfgTokens.map((t) => BigInt(t.maxAmount));
    const fieldHashes  = wireCfg.fields.map((n) => ethers.keccak256(ethers.toUtf8Bytes(n)));
    const fixedAmounts = wireCfg.fixedAmounts.map((n) => BigInt(n));

    const WireFactory = await ethers.getContractFactory('Web3QLRelationWire', deployer);
    const wire = await WireFactory.deploy(
      wireCfg.sourceTable,
      wireCfg.targetTable,
      allowedTokenAddrs, minAmounts, maxAmounts,
      fieldHashes, wireCfg.usePayment, fixedAmounts,
      wireCfg.oncePerAddress, wireCfg.feeRecipient, wireCfg.feeBps,
      deployer.address,
    );
    await wire.waitForDeployment();
    wireAddress = await wire.getAddress();
    console.log(`  ${pad('Wire')}  : ${wireAddress}`);

    // Register on target table
    const tableAbi = [
      'function registerWire(address wire, bytes32[] calldata fields) external',
      'function owner() view returns (address)',
    ];
    const targetContract = new ethers.Contract(wireCfg.targetTable, tableAbi, deployer);
    const tableOwner     = await targetContract.owner();
    if (tableOwner.toLowerCase() === deployer.address.toLowerCase()) {
      const regTx = await targetContract.registerWire(wireAddress, fieldHashes);
      await regTx.wait();
      console.log(`  ✅ Wire registered on target table`);
    } else {
      console.log(`  ⚠️  Deployer is not target table owner — register wire manually:`);
      console.log(`     targetTable.registerWire('${wireAddress}', ${JSON.stringify(fieldHashes)})`);
    }
  } else {
    console.log('\n── Step 3: RelationWire ─────────────────────────────');
    console.log('  Skipped — set sourceTable + targetTable in HARDCODED_WIRE_CONFIG');
    console.log('  or pass WIRE_CONFIG env var to deploy a wire.');
  }

  // ─────────────────────────────────────────────────────────────
  //  Persist — config + combined deployment JSON
  // ─────────────────────────────────────────────────────────────
  const configPath = path.resolve(process.cwd(), 'web3ql.config.json');
  const existing   = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : {};

  existing[networkLabel] = {
    factoryAddress  : factoryAddress,
    databaseImpl    : databaseImplAddress,
    tableImpl       : tableImplAddress,
    registryAddress : registryAddress,
    cloudDatabase   : cloudDbAddress,
    ...(wireAddress ? { wireAddress } : {}),
    deployedAt      : timestamp,
    deployer        : deployer.address,
  };
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));

  const deploymentsDir = path.resolve(process.cwd(), 'deployments', networkLabel);
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const combined = {
    deployedAt      : timestamp,
    network         : networkLabel,
    chainId         : Number(network.chainId),
    deployer        : deployer.address,
    // Step 1
    factoryAddress,
    registryAddress,
    databaseImpl    : databaseImplAddress,
    tableImpl       : tableImplAddress,
    // Step 2
    cloudDatabase   : cloudDbAddress,
    // Step 3
    ...(wireAddress ? {
      wireAddress,
      wireSourceTable : wireCfg.sourceTable,
      wireTargetTable : wireCfg.targetTable,
      wireFields      : wireCfg.fields,
    } : { wireAddress: null }),
  };

  const outFile = path.join(deploymentsDir, `${datePart}_deploy-all_${factoryAddress}.json`);
  fs.writeFileSync(outFile, JSON.stringify(combined, null, 2));

  // ─────────────────────────────────────────────────────────────
  //  Summary
  // ─────────────────────────────────────────────────────────────
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   All Done!                                       ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`  ${pad('Factory')}  : ${factoryAddress}`);
  console.log(`  ${pad('Registry')}  : ${registryAddress}`);
  console.log(`  ${pad('Cloud DB')}  : ${cloudDbAddress}`);
  if (wireAddress) {
  console.log(`  ${pad('Wire')}  : ${wireAddress}`);
  }
  console.log(`\n  Deployment JSON : ${path.relative(process.cwd(), outFile)}`);

  console.log('\n  ── Paste into cloud/.env (via dotenvx set) ──────');
  console.log(`  NEXT_PUBLIC_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`  NEXT_PUBLIC_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`  NEXT_PUBLIC_CLOUD_DB=${cloudDbAddress}`);
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
