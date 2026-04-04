/**
 * @file   deploy-cloud.ts
 * @notice Deploy a "cloud" database from the factory.
 *
 *         Reads the live factory address from web3ql.config.json,
 *         calls factory.createDatabase("cloud") with the deployer as
 *         the database admin/owner, and persists the resulting
 *         database address back into config + a timestamped record.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-cloud.ts --network celoSepolia
 *   npx hardhat run scripts/deploy-cloud.ts --network celo
 */

import { ethers } from 'hardhat';
import * as fs   from 'fs';
import * as path from 'path';

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();
  const networkLabel = network.name === 'unknown'
    ? `chain_${network.chainId}`
    : network.name;

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Web3QL Cloud — Database Deployment');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Network   : ${networkLabel} (chainId ${network.chainId})`);
  console.log(`  Deployer  : ${deployer.address}  (will be database admin)`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance   : ${ethers.formatEther(balance)} CELO`);
  console.log('');

  // ── Load factory address from config ──────────────────────────
  const configPath = path.resolve(process.cwd(), 'web3ql.config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('web3ql.config.json not found — run deploy-factory first.');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const networkConfig = config[networkLabel];
  if (!networkConfig?.factoryAddress) {
    throw new Error(
      `No factory address for "${networkLabel}" in web3ql.config.json.\n` +
      `Run: npx hardhat run scripts/deploy-factory.ts --network ${networkLabel}`
    );
  }

  const factoryAddress: string = networkConfig.factoryAddress;
  console.log(`  Factory   : ${factoryAddress}`);

  // ── Attach to the deployed factory ────────────────────────────
  const factory = await ethers.getContractAt('Web3QLFactory', factoryAddress, deployer);

  // ── Call createDatabase("cloud") ──────────────────────────────
  console.log('\nCreating "cloud" database …');
  const tx = await factory.createDatabase('cloud');
  console.log(`  tx hash   : ${tx.hash}`);
  const receipt = await tx.wait();

  // Parse the DatabaseCreated event to get the deployed address
  const iface    = factory.interface;
  let dbAddress  = '';
  for (const log of receipt!.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'DatabaseCreated') {
        dbAddress = parsed.args.db as string;
        break;
      }
    } catch { /* skip unrelated logs */ }
  }

  if (!dbAddress) {
    throw new Error('DatabaseCreated event not found in receipt — check tx manually.');
  }

  console.log(`\n  ✅ Cloud database deployed!`);
  console.log(`  Address   : ${dbAddress}`);
  console.log(`  Owner     : ${deployer.address}`);

  // ── Persist to config FIRST (before any view calls) ──────────
  config[networkLabel].cloudDatabase = dbAddress;
  config[networkLabel].cloudDatabaseDeployedAt = new Date().toISOString();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\n  Config updated    : web3ql.config.json [${networkLabel}.cloudDatabase]`);

  // ── Write timestamped deployment record ───────────────────────
  const deploymentsDir = path.resolve(process.cwd(), 'deployments', networkLabel);
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const datePart   = new Date().toISOString().slice(0, 10);
  const deployFile = path.join(deploymentsDir, `${datePart}_cloud_${dbAddress}.json`);
  fs.writeFileSync(deployFile, JSON.stringify({
    deployedAt   : new Date().toISOString(),
    network      : networkLabel,
    chainId      : Number(network.chainId),
    deployer     : deployer.address,
    factory      : factoryAddress,
    databaseAddr : dbAddress,
    txHash       : tx.hash,
  }, null, 2));
  console.log(`  Deployment record : ${path.relative(process.cwd(), deployFile)}`);

  // ── Verify deployer is the database owner (optional, with retry) ──
  let verifiedOwner = '(verify manually)';
  try {
    // Brief delay to let Celo RPC catch up after block finalization
    await new Promise(r => setTimeout(r, 3000));
    const database = await ethers.getContractAt('Web3QLDatabase', dbAddress, deployer);
    verifiedOwner  = await database.owner();
    const name     = await database.databaseName();
    console.log(`\n  DB Name   : ${name}`);
    console.log(`  DB Owner  : ${verifiedOwner}`);
    if (verifiedOwner.toLowerCase() === deployer.address.toLowerCase()) {
      console.log(`  ✅ Ownership confirmed — deployer is admin`);
    }
  } catch {
    console.log(`  ⚠️  Could not verify owner via view call (RPC lag) — tx succeeded, check on explorer`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Done. Use this in the cloud app:');
  console.log(`  NEXT_PUBLIC_CLOUD_DB=${dbAddress}`);
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
