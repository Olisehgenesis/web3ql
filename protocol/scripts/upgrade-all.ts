/**
 * @file   upgrade-all.ts
 * @notice Upgrade Web3QL UUPS proxy contracts to their latest implementations.
 *
 * By default upgrades everything: Web3QLFactory + PublicKeyRegistry.
 * Pass UPGRADE_ONLY to target a specific contract:
 *
 *   UPGRADE_ONLY=factory   npx hardhat run scripts/upgrade-all.ts --network celoSepolia
 *   UPGRADE_ONLY=registry  npx hardhat run scripts/upgrade-all.ts --network celoSepolia
 *
 * Or pass explicit proxy addresses to override what's in web3ql.config.json:
 *
 *   FACTORY_PROXY=0x...   npx hardhat run scripts/upgrade-all.ts --network celoSepolia
 *   REGISTRY_PROXY=0x...  npx hardhat run scripts/upgrade-all.ts --network celoSepolia
 *
 * Addresses are read from web3ql.config.json for the active network.
 * The config file is NOT modified — proxy addresses never change on upgrades.
 */

import { ethers, upgrades } from 'hardhat';
import * as fs   from 'fs';
import * as path from 'path';

async function upgradeContract(
  contractName : string,
  proxyAddress : string,
  deployer     : ethers.Signer,
): Promise<string> {
  console.log(`\nUpgrading ${contractName} …`);
  console.log(`  Proxy   : ${proxyAddress}`);

  const Factory  = await ethers.getContractFactory(contractName, deployer);
  const upgraded = await upgrades.upgradeProxy(proxyAddress, Factory, { kind: 'uups' });
  await upgraded.waitForDeployment();

  // The new implementation address (proxy address stays the same)
  const newImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`  New impl: ${newImpl}`);
  console.log(`  ✅ ${contractName} upgraded`);
  return newImpl;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();
  const networkLabel = network.name === 'unknown'
    ? `chain_${network.chainId}`
    : network.name;

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Web3QL — Upgrade Contracts');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Network  : ${networkLabel} (chainId ${network.chainId})`);
  console.log(`  Upgrader : ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance  : ${ethers.formatEther(balance)} CELO`);

  // ── Load config ───────────────────────────────────────────────
  const configPath = path.resolve(process.cwd(), 'web3ql.config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('web3ql.config.json not found — run deploy-factory first.');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const networkConfig = config[networkLabel];
  if (!networkConfig) {
    throw new Error(
      `No config for "${networkLabel}" in web3ql.config.json.\n` +
      `Run: pnpm deploy:sepolia (or deploy:celo) first.`
    );
  }

  // ── Resolve proxy addresses (env overrides config) ────────────
  const factoryProxy  = process.env.FACTORY_PROXY  ?? networkConfig.factoryAddress;
  const registryProxy = process.env.REGISTRY_PROXY ?? networkConfig.registryAddress;

  // ── Decide what to upgrade ────────────────────────────────────
  const only = (process.env.UPGRADE_ONLY ?? 'all').toLowerCase();

  const results: Record<string, string> = {};

  if (only === 'all' || only === 'factory') {
    if (!factoryProxy || !ethers.isAddress(factoryProxy)) {
      throw new Error(`Invalid factory proxy address: "${factoryProxy}"`);
    }
    results['Web3QLFactory'] = await upgradeContract('Web3QLFactory', factoryProxy, deployer);
  }

  if (only === 'all' || only === 'registry') {
    if (!registryProxy || !ethers.isAddress(registryProxy)) {
      throw new Error(`Invalid registry proxy address: "${registryProxy}"`);
    }
    results['PublicKeyRegistry'] = await upgradeContract('PublicKeyRegistry', registryProxy, deployer);
  }

  if (only !== 'all' && only !== 'factory' && only !== 'registry') {
    throw new Error(
      `Unknown UPGRADE_ONLY value: "${process.env.UPGRADE_ONLY}".\n` +
      `Valid values: factory | registry | all`
    );
  }

  // ── Persist new impl addresses into config ────────────────────
  const timestamp = new Date().toISOString();
  if (results['Web3QLFactory'])     networkConfig.factoryImpl    = results['Web3QLFactory'];
  if (results['PublicKeyRegistry']) networkConfig.registryImpl   = results['PublicKeyRegistry'];
  networkConfig.lastUpgradedAt = timestamp;
  networkConfig.lastUpgrader   = deployer.address;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\n  Config updated    : web3ql.config.json [${networkLabel}]`);

  // ── Save timestamped upgrade record ──────────────────────────
  const deploymentsDir = path.resolve(process.cwd(), 'deployments', networkLabel);
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const datePart    = timestamp.slice(0, 10);
  const upgradeFile = path.join(deploymentsDir, `${datePart}_upgrade.json`);
  fs.writeFileSync(upgradeFile, JSON.stringify({
    upgradedAt : timestamp,
    network    : networkLabel,
    chainId    : Number(network.chainId),
    upgrader   : deployer.address,
    contracts  : results,
  }, null, 2));
  console.log(`  Upgrade record    : ${path.relative(process.cwd(), upgradeFile)}`);

  // ── Summary ───────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Done!');
  console.log('═══════════════════════════════════════════════════');
  for (const [name, impl] of Object.entries(results)) {
    console.log(`  ${name.padEnd(22)}: impl → ${impl}`);
  }
  console.log('\n  Note: proxy addresses are unchanged — no config update needed in the app.');
}

main().catch((e) => { console.error(e); process.exit(1); });
