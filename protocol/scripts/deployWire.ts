/**
 * @file   deployWire.ts
 * @notice Deploy a Web3QLRelationWire and register it on the target table.
 *
 *         Both steps happen in sequence (2 transactions) so the resulting
 *         wire is immediately active.
 *
 * Usage (pass config as a JSON argument via WIRE_CONFIG env var):
 *
 *   WIRE_CONFIG='{
 *     "sourceTable": "0x...",
 *     "targetTable": "0x...",
 *     "fields": ["tip_total", "tip_count"],
 *     "usePayment": [true, false],
 *     "fixedAmounts": ["0", "1"],
 *     "minPayment": "10000000000000000",
 *     "oncePerAddress": false,
 *     "feeRecipient": "0x0000000000000000000000000000000000000000",
 *     "feeBps": 0
 *   }' npx hardhat run scripts/deployWire.ts --network celoSepolia
 *
 * Fields are passed as plain strings — the script hashes them with
 * keccak256(abi.encodePacked(fieldName)) to match what the table expects.
 *
 * You can also hard-code the config below in HARDCODED_CONFIG for quick
 * iteration during prototyping.
 */

import { ethers } from 'hardhat';

// ─────────────────────────────────────────────────────────────
//  Config — edit here for quick local runs, or use WIRE_CONFIG env
// ─────────────────────────────────────────────────────────────

const HARDCODED_CONFIG = {
  // Addresses of already-deployed tables
  sourceTable     : '',   // e.g. votes / tips table
  targetTable     : '',   // e.g. projects table (has COUNTER fields)

  /**
   * Accepted payment tokens.
   * Each entry: { token, minAmount, maxAmount }
   *   token     : address string; 'native' or address(0) = native CELO
   *   minAmount : '0' = no minimum
   *   maxAmount : '0' = no maximum
   *
   * Default: native CELO only, no limits.
   * Add ERC-20 entries as needed, e.g.:
   *   { token: '0xcUSDAddress...', minAmount: '1000000', maxAmount: '0' }
   */
  allowedTokens: [
    { token: 'native', minAmount: '0', maxAmount: '0' },
  ],

  // Counter fields on the TARGET table to touch, in order
  fields          : ['tip_total', 'tip_count'],

  // Parallel to fields: true = use netPayment for counter; false = use fixedAmounts[i]
  usePayment      : [true, false],

  // Used when usePayment[i] = false; pass "0" for unused slots
  fixedAmounts    : ['0', '1'],

  // Rules
  oncePerAddress  : false,
  feeRecipient    : ethers.ZeroAddress,
  feeBps          : 0,
};

// ─────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Web3QL — RelationWire Deployment');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Network   : ${network.name} (chainId ${network.chainId})`);
  console.log(`  Deployer  : ${deployer.address}`);

  // Merge env config over hardcoded defaults
  let cfg = { ...HARDCODED_CONFIG };
  if (process.env.WIRE_CONFIG) {
    try {
      cfg = { ...cfg, ...JSON.parse(process.env.WIRE_CONFIG) };
    } catch (e) {
      throw new Error(`WIRE_CONFIG is not valid JSON: ${e}`);
    }
  }

  if (!cfg.sourceTable || !ethers.isAddress(cfg.sourceTable)) {
    throw new Error('sourceTable address missing or invalid in config.');
  }
  if (!cfg.targetTable || !ethers.isAddress(cfg.targetTable)) {
    throw new Error('targetTable address missing or invalid in config.');
  }
  if (cfg.fields.length === 0) {
    throw new Error('fields array must not be empty.');
  }
  if (cfg.fields.length !== cfg.usePayment.length || cfg.fields.length !== cfg.fixedAmounts.length) {
    throw new Error('fields, usePayment, and fixedAmounts must be the same length.');
  }

  const ZERO = '0x0000000000000000000000000000000000000000';
  const cfgTokens: Array<{ token: string; minAmount: string; maxAmount: string }> =
    (cfg as any).allowedTokens ?? [{ token: 'native', minAmount: '0', maxAmount: '0' }];

  const allowedTokenAddrs = cfgTokens.map((t) =>
    t.token === 'native' || t.token === ZERO ? ZERO : t.token
  );
  const minAmounts = cfgTokens.map((t) => BigInt(t.minAmount));
  const maxAmounts = cfgTokens.map((t) => BigInt(t.maxAmount));

  const tokenDescriptions = cfgTokens.map((t, i) => {
    const addr = allowedTokenAddrs[i];
    const min  = minAmounts[i];
    const max  = maxAmounts[i];
    return `${addr === ZERO ? 'native CELO' : addr} (min=${min}, max=${max === 0n ? '∞' : max})`;
  });

  console.log(`  Source    : ${cfg.sourceTable}`);
  console.log(`  Target    : ${cfg.targetTable}`);
  console.log(`  Tokens    : ${tokenDescriptions.join(' | ')}`);
  console.log(`  Fields    : ${cfg.fields.join(', ')}`);
  console.log(`  usePayment: ${cfg.usePayment.join(', ')}`);
  console.log(`  once?     : ${cfg.oncePerAddress}`);

  // ── Hash field names (keccak256 of field name string) ─────────
  const fieldHashes = cfg.fields.map((name) =>
    ethers.keccak256(ethers.toUtf8Bytes(name))
  );
  const fixedAmounts = cfg.fixedAmounts.map((n) => BigInt(n));

  console.log('\n  Field hashes:');
  cfg.fields.forEach((name, i) => {
    console.log(`    ${name} → ${fieldHashes[i]}`);
  });

  // ── Deploy Web3QLRelationWire ──────────────────────────────────
  console.log('\nDeploying Web3QLRelationWire …');

  const WireFactory = await ethers.getContractFactory('Web3QLRelationWire', deployer);
  const wire = await WireFactory.deploy(
    cfg.sourceTable,
    cfg.targetTable,
    allowedTokenAddrs,
    minAmounts,
    maxAmounts,
    fieldHashes,
    cfg.usePayment,
    fixedAmounts,
    cfg.oncePerAddress,
    cfg.feeRecipient,
    cfg.feeBps,
    deployer.address,
  );
  await wire.waitForDeployment();
  const wireAddress = await wire.getAddress();
  console.log(`  ✅ Wire deployed : ${wireAddress}`);

  // ── Register wire on target table ─────────────────────────────
  console.log('\nRegistering wire on target table …');
  console.log('  (Caller must be the target table owner)');

  const tableAbi = [
    'function registerWire(address wire, bytes32[] calldata fields) external',
    'function owner() view returns (address)',
  ];
  const targetTable = new ethers.Contract(cfg.targetTable, tableAbi, deployer);

  // Sanity check: verify deployer is the table owner
  const tableOwner = await targetTable.owner();
  if (tableOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `Deployer ${deployer.address} is NOT the table owner (${tableOwner}).\n` +
      `Call registerWire manually from the owner wallet:\n\n` +
      `  targetTable.registerWire(\n    '${wireAddress}',\n    ${JSON.stringify(fieldHashes)}\n  )`
    );
  }

  const regTx = await targetTable.registerWire(wireAddress, fieldHashes);
  console.log(`  tx hash   : ${regTx.hash}`);
  await regTx.wait();
  console.log(`  ✅ Wire registered on target table`);

  // ── Summary ───────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Done!');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Wire contract : ${wireAddress}`);
  console.log(`  Tokens        : ${tokenDescriptions.join(' | ')}`);
  console.log(`  Source table  : ${cfg.sourceTable}`);
  console.log(`  Target table  : ${cfg.targetTable}`);
  console.log(`  Fields wired  : ${cfg.fields.join(', ')}`);
  const erc20Tokens = allowedTokenAddrs.filter((a) => a !== ZERO);
  if (erc20Tokens.length > 0) {
    console.log(`\n  ERC-20 callers must approve before using:`);
    erc20Tokens.forEach((t) =>
      console.log(`    await model.approveWire('${wireAddress}', '${t}', amount)`)
    );
  }
  console.log('\n  Users can now call wire.relatedWrite() to atomically');
  console.log('  write to the source table and increment counters on the target.');
  console.log('\n  Project owners claim funds via:');
  console.log(`    await projects.withdrawAllFunds('${wireAddress}', projectId);`);
  console.log('\n  Read counters (no SDK needed):');
  cfg.fields.forEach((name, i) => {
    console.log(`    targetTable.counterValue(recordKey, '${fieldHashes[i]}')  // ${name}`);
  });
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
