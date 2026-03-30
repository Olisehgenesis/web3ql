/**
 * @file   deploy-factory.ts
 * @notice Deploy the Web3QL protocol contracts to Celo.
 *
 * Deploys:
 *   1. Web3QLAccess       (library — no deployment needed; abstract)
 *   2. Web3QLTable        implementation contract
 *   3. Web3QLDatabase     implementation contract
 *   4. Web3QLFactory      UUPS proxy (the singleton entry point)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-factory.ts --network celo
 *   npx hardhat run scripts/deploy-factory.ts --network celoSepolia
 */

import { ethers, upgrades } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Web3QL Protocol — Factory Deployment');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Network   : ${network.name} (chainId ${network.chainId})`);
  console.log(`  Deployer  : ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance   : ${ethers.formatEther(balance)} CELO`);
  console.log('');

  // ── 1. Deploy Web3QLTable implementation ──────────────────────
  console.log('Deploying Web3QLTable implementation …');
  const TableImpl = await ethers.getContractFactory('Web3QLTable');
  const tableImpl = await TableImpl.deploy();
  await tableImpl.waitForDeployment();
  const tableImplAddress = await tableImpl.getAddress();
  console.log(`  Web3QLTable impl  : ${tableImplAddress}`);

  // ── 2. Deploy Web3QLDatabase implementation ───────────────────
  console.log('Deploying Web3QLDatabase implementation …');
  const DatabaseImpl = await ethers.getContractFactory('Web3QLDatabase');
  const databaseImpl = await DatabaseImpl.deploy();
  await databaseImpl.waitForDeployment();
  const databaseImplAddress = await databaseImpl.getAddress();
  console.log(`  Web3QLDatabase impl: ${databaseImplAddress}`);

  // ── 3. Deploy Web3QLFactory as UUPS proxy ─────────────────────
  console.log('Deploying Web3QLFactory proxy (UUPS) …');
  const Factory = await ethers.getContractFactory('Web3QLFactory');
  const factory = await upgrades.deployProxy(
    Factory,
    [deployer.address, databaseImplAddress, tableImplAddress],
    { kind: 'uups', initializer: 'initialize' }
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`  Web3QLFactory proxy: ${factoryAddress}`);

  // ── 4. Persist deployment addresses ───────────────────────────
  const configPath = path.resolve(process.cwd(), 'web3ql.config.json');
  const existing   = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : {};

  const networkKey = `${network.name}_${network.chainId}`;
  existing[networkKey] = {
    factoryAddress   : factoryAddress,
    databaseImpl     : databaseImplAddress,
    tableImpl        : tableImplAddress,
    deployedAt       : new Date().toISOString(),
    deployer         : deployer.address,
  };

  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
  console.log(`\n  Addresses saved to: web3ql.config.json (key: "${networkKey}")`);

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  Factory deployed at: ${factoryAddress}`);
  console.log('═══════════════════════════════════════════════════\n');

  return { factoryAddress, databaseImplAddress, tableImplAddress };
}

main()
  .then((r) => { console.log('Done.', r); })
  .catch((e) => { console.error(e); process.exit(1); });
