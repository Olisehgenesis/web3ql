/**
 * @file   deploy-factory.ts
 * @notice Deploy the Web3QL protocol contracts to Celo.
 *
 * Deploys:
 *   1. Web3QLTable        implementation contract
 *   2. Web3QLDatabase     implementation contract
 *   3. Web3QLFactory      UUPS proxy (the singleton entry point)
 *   4. PublicKeyRegistry  UUPS proxy (X25519 key registry for sharing)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-factory.ts --network celo
 *   npx hardhat run scripts/deploy-factory.ts --network celoSepolia
 *
 * After deploy, paste the printed addresses into:
 *   cloud/.env.local          NEXT_PUBLIC_FACTORY_ADDRESS / NEXT_PUBLIC_REGISTRY_ADDRESS
 *   web3ql.config.json        (auto-updated by this script)
 */

import { ethers, upgrades } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Web3QL Protocol — Full Deployment');
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
  console.log(`  Web3QLTable impl   : ${tableImplAddress}`);

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

  // ── 4. Deploy PublicKeyRegistry as UUPS proxy ─────────────────
  console.log('Deploying PublicKeyRegistry proxy (UUPS) …');
  const Registry = await ethers.getContractFactory('PublicKeyRegistry');
  const registry = await upgrades.deployProxy(
    Registry,
    [deployer.address],
    { kind: 'uups', initializer: 'initialize' }
  );
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`  PublicKeyRegistry   : ${registryAddress}`);

  // ── 5. Persist deployment addresses ───────────────────────────
  const networkLabel = network.name === 'unknown' ? `chain_${network.chainId}` : network.name;
  const timestamp    = new Date().toISOString();
  const datePart     = timestamp.slice(0, 10); // YYYY-MM-DD

  const deployment = {
    deployedAt      : timestamp,
    network         : networkLabel,
    chainId         : Number(network.chainId),
    deployer        : deployer.address,
    factoryAddress  : factoryAddress,
    databaseImpl    : databaseImplAddress,
    tableImpl       : tableImplAddress,
    registryAddress : registryAddress,
  };

  // Write per-deployment file
  const deploymentsDir = path.resolve(process.cwd(), 'deployments', networkLabel);
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const deployFile = path.join(deploymentsDir, `${datePart}_${factoryAddress}.json`);
  fs.writeFileSync(deployFile, JSON.stringify(deployment, null, 2));
  console.log(`\n  Deployment record : ${path.relative(process.cwd(), deployFile)}`);

  // Update web3ql.config.json
  const configPath = path.resolve(process.cwd(), 'web3ql.config.json');
  const existing   = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : {};

  existing[networkLabel] = {
    factoryAddress  : factoryAddress,
    databaseImpl    : databaseImplAddress,
    tableImpl       : tableImplAddress,
    registryAddress : registryAddress,
    deployedAt      : timestamp,
    deployer        : deployer.address,
  };

  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
  console.log(`  Config updated    : web3ql.config.json [${networkLabel}]`);

  // Print env vars to paste into cloud/.env.local
  console.log('\n  ── Paste into cloud/.env.local ──────────────────');
  console.log(`  NEXT_PUBLIC_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`  NEXT_PUBLIC_REGISTRY_ADDRESS=${registryAddress}`);

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  Factory  : ${factoryAddress}`);
  console.log(`  Registry : ${registryAddress}`);
  console.log('═══════════════════════════════════════════════════\n');

  return { factoryAddress, databaseImplAddress, tableImplAddress, registryAddress };
}

main()
  .then((r) => { console.log('Done.', r); })
  .catch((e) => { console.error(e); process.exit(1); });
