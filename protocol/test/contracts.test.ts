/**
 * @file   contracts.test.ts
 * @notice Hardhat integration tests for the full Web3QL contract stack.
 *         Factory → Database → Table lifecycle, access control, key management.
 */

import { expect }                        from 'chai';
import { ethers, upgrades }              from 'hardhat';
import type { SignerWithAddress }        from '@nomicfoundation/hardhat-ethers/signers';
import type {
  Web3QLFactory,
  Web3QLDatabase,
  Web3QLTable,
}                                        from '../typechain-types/index.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function toBytes(s: string): Uint8Array {
  return ethers.toUtf8Bytes(s);
}

function randKey(): string {
  return ethers.id(Math.random().toString());   // deterministic in tests: fine
}

// Mock "ciphertext" — just ABI-encoded plaintext for testing
function mockCiphertext(data: unknown): string {
  return ethers.hexlify(ethers.toUtf8Bytes(JSON.stringify(data)));
}

// Mock per-user encrypted-key blob
function mockEncKey(label: string): string {
  return ethers.hexlify(ethers.toUtf8Bytes(`enckey:${label}`));
}

// ─── shared deployment fixture ────────────────────────────────────────────────

async function deployStack() {
  const [owner, alice, bob, carol, ...rest] = await ethers.getSigners();

  // 1. Deploy implementations
  const AccessF = await ethers.getContractFactory('Web3QLAccess');
  const TableF  = await ethers.getContractFactory('Web3QLTable');
  const DBF     = await ethers.getContractFactory('Web3QLDatabase');
  const FactoryF = await ethers.getContractFactory('Web3QLFactory');

  // Note: We don't deploy Access standalone — it's abstract / inherited by Table.
  const tableImpl = await TableF.deploy();
  await tableImpl.waitForDeployment();

  const dbImpl = await DBF.deploy();
  await dbImpl.waitForDeployment();

  // 2. Deploy Factory as UUPS proxy
  const factory = (await upgrades.deployProxy(
    FactoryF,
    [await tableImpl.getAddress(), await dbImpl.getAddress()],
    { kind: 'uups', initializer: 'initialize' }
  )) as unknown as Web3QLFactory;
  await factory.waitForDeployment();

  // 3. Create a database for `owner`
  const tx = await factory.connect(owner).createDatabase();
  const receipt = await tx.wait();

  // Grab the database address from event
  const event = receipt!.logs
    .map((l) => {
      try { return factory.interface.parseLog(l); } catch { return null; }
    })
    .find((e) => e?.name === 'DatabaseCreated');

  const dbAddress = event!.args.db as string;
  const db = DBF.attach(dbAddress).connect(owner) as unknown as Web3QLDatabase;

  // 4. Create a table inside the database
  const schemaBytes = ethers.hexlify(ethers.toUtf8Bytes('users:id:INT,name:TEXT'));
  const txT = await db.createTable('users', schemaBytes);
  const receiptT = await txT.wait();

  const eventT = receiptT!.logs
    .map((l) => {
      try { return db.interface.parseLog(l); } catch { return null; }
    })
    .find((e) => e?.name === 'TableCreated');

  const tableAddress = eventT!.args.tableContract as string;
  const table = TableF.attach(tableAddress).connect(owner) as unknown as Web3QLTable;

  return { factory, db, table, owner, alice, bob, carol, rest };
}

// ─── test suites ─────────────────────────────────────────────────────────────

describe('Web3QLFactory', () => {
  it('deploys and initialises correctly', async () => {
    const { factory, owner } = await deployStack();
    const dbs = await factory.getUserDatabases(owner.address);
    expect(dbs.length).to.equal(1);
  });

  it('creates distinct databases per user', async () => {
    const { factory, owner, alice } = await deployStack();
    await (await factory.connect(alice).createDatabase()).wait();

    const ownerDbs = await factory.getUserDatabases(owner.address);
    const aliceDbs = await factory.getUserDatabases(alice.address);
    expect(ownerDbs.length).to.equal(1);
    expect(aliceDbs.length).to.equal(1);
    expect(ownerDbs[0]).to.not.equal(aliceDbs[0]);
  });

  it('only owner can update implementations', async () => {
    const { factory, alice, tableImpl, dbImpl } = await deployStack() as any;
    await expect(
      factory.connect(alice).setImplementations(
        await tableImpl.getAddress(),
        await dbImpl.getAddress()
      )
    ).to.be.revertedWithCustomError(factory, 'OwnableUnauthorizedAccount');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Web3QLDatabase', () => {
  it('creates a table and lists it', async () => {
    const { db } = await deployStack();
    const tables = await db.listTables();
    expect(tables).to.include('users');
  });

  it('getTable returns a nonzero address', async () => {
    const { db } = await deployStack();
    const addr = await db.getTable('users');
    expect(addr).to.be.properAddress;
    expect(addr).to.not.equal(ethers.ZeroAddress);
  });

  it('reverts on duplicate table name', async () => {
    const { db } = await deployStack();
    const schema = ethers.hexlify(ethers.toUtf8Bytes('users:id:INT'));
    await expect(
      db.createTable('users', schema)
    ).to.be.revertedWith(/already exists|AlreadyExists/i);
  });

  it('only database owner can create tables', async () => {
    const { db, alice } = await deployStack();
    const schema = ethers.hexlify(ethers.toUtf8Bytes('items:id:INT'));
    await expect(
      db.connect(alice).createTable('items', schema)
    ).to.be.reverted;
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Web3QLTable — basic write / read', () => {
  it('owner can write and read back ciphertext', async () => {
    const { table, owner } = await deployStack();

    const key       = randKey();
    const cipher    = mockCiphertext({ id: 1, name: 'Alice' });
    const ownerKey  = mockEncKey('owner');

    await (await table.write(key, toBytes(cipher), toBytes(ownerKey))).wait();

    const [storedCipher] = await table.read(key);
    expect(storedCipher).to.equal(cipher);
  });

  it('write increments version on update', async () => {
    const { table } = await deployStack();

    const key    = randKey();
    const cipher = mockCiphertext({ id: 1, name: 'v1' });
    const eKey   = mockEncKey('v1');

    await (await table.write(key, toBytes(cipher), toBytes(eKey))).wait();

    const cipher2 = mockCiphertext({ id: 1, name: 'v2' });
    await (await table.updateRecord(key, toBytes(cipher2))).wait();

    const [, , version] = await table.read(key);
    expect(version).to.equal(2n);
  });

  it('reverts when non-owner tries to write without write access', async () => {
    const { table, alice } = await deployStack();
    const key    = randKey();
    const cipher = mockCiphertext({ id: 1 });
    const eKey   = mockEncKey('alice');

    await expect(
      table.connect(alice).write(key, toBytes(cipher), toBytes(eKey))
    ).to.be.reverted;
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Web3QLTable — access control & encrypted keys', () => {
  it('owner can grant VIEWER access and collaborator reads their encrypted key', async () => {
    const { table, owner, alice } = await deployStack();

    const key        = randKey();
    const cipher     = mockCiphertext({ id: 1 });
    const ownerEKey  = mockEncKey('owner');
    const aliceEKey  = mockEncKey('alice');

    // Write as owner
    await (await table.write(key, toBytes(cipher), toBytes(ownerEKey))).wait();

    // Grant alice VIEWER (role = 2)
    await (await table.grantAccess(key, alice.address, 2, toBytes(aliceEKey))).wait();

    // Alice reads her encrypted key
    const retrieved = await table.connect(alice).getMyEncryptedKey(key);
    expect(ethers.toUtf8String(retrieved)).to.equal(`enckey:alice`);
  });

  it('owner can grant EDITOR access and collaborator writes', async () => {
    const { table, owner, bob } = await deployStack();

    const key       = randKey();
    const cipher    = mockCiphertext({ id: 2 });
    const ownerEKey = mockEncKey('owner');
    const bobEKey   = mockEncKey('bob');

    await (await table.write(key, toBytes(cipher), toBytes(ownerEKey))).wait();

    // Grant bob EDITOR (role = 1)
    await (await table.grantAccess(key, bob.address, 1, toBytes(bobEKey))).wait();

    const newCipher = mockCiphertext({ id: 2, name: 'updated by bob' });
    await (await table.connect(bob).updateRecord(key, toBytes(newCipher))).wait();

    const [stored] = await table.read(key);
    expect(stored).to.equal(newCipher);
  });

  it('revoke removes the encrypted key', async () => {
    const { table, alice } = await deployStack();

    const key       = randKey();
    const cipher    = mockCiphertext({ id: 3 });
    const ownerEKey = mockEncKey('owner');
    const aliceEKey = mockEncKey('alice');

    await (await table.write(key, toBytes(cipher), toBytes(ownerEKey))).wait();
    await (await table.grantAccess(key, alice.address, 2, toBytes(aliceEKey))).wait();
    await (await table.revokeAccess(key, alice.address)).wait();

    // Alice should no longer have a key
    const retrieved = await table.connect(alice).getMyEncryptedKey(key);
    expect(retrieved).to.equal('0x');
  });

  it('only owner can grant/revoke access', async () => {
    const { table, alice, bob } = await deployStack();

    const key    = randKey();
    const cipher = mockCiphertext({ id: 4 });
    const eKey   = mockEncKey('owner');

    await (await table.write(key, toBytes(cipher), toBytes(eKey))).wait();

    await expect(
      table.connect(alice).grantAccess(key, bob.address, 2, toBytes(mockEncKey('bob')))
    ).to.be.reverted;

    await expect(
      table.connect(alice).revokeAccess(key, bob.address)
    ).to.be.reverted;
  });

  it('enforces MAX_COLLABORATORS limit', async () => {
    const { table, rest } = await deployStack();

    const key    = randKey();
    const cipher = mockCiphertext({ id: 5 });
    const eKey   = mockEncKey('owner');

    await (await table.write(key, toBytes(cipher), toBytes(eKey))).wait();

    // Grant up to MAX_COLLABORATORS (10)
    for (let i = 0; i < 10; i++) {
      const signer = rest[i];
      await (await table.grantAccess(
        key, signer.address, 2, toBytes(mockEncKey(`extra${i}`))
      )).wait();
    }

    // The 11th should revert
    const eleventh = rest[10];
    await expect(
      table.grantAccess(key, eleventh.address, 2, toBytes(mockEncKey('extra10')))
    ).to.be.revertedWith(/MaxCollaborators|TooManyCollaborators/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Web3QLTable — delete & key scrubbing', () => {
  it('deleteRecord marks record as deleted', async () => {
    const { table } = await deployStack();

    const key    = randKey();
    const cipher = mockCiphertext({ id: 6 });
    const eKey   = mockEncKey('owner');

    await (await table.write(key, toBytes(cipher), toBytes(eKey))).wait();
    await (await table.deleteRecord(key)).wait();

    const exists = await table.recordExists(key);
    expect(exists).to.be.false;
  });

  it('deleteRecord scrubs all collaborator keys', async () => {
    const { table, alice, bob } = await deployStack();

    const key    = randKey();
    const cipher = mockCiphertext({ id: 7 });
    const eKey   = mockEncKey('owner');

    await (await table.write(key, toBytes(cipher), toBytes(eKey))).wait();
    await (await table.grantAccess(key, alice.address, 2, toBytes(mockEncKey('alice')))).wait();
    await (await table.grantAccess(key, bob.address,   2, toBytes(mockEncKey('bob')))).wait();

    await (await table.deleteRecord(key)).wait();

    // Both collaborators' keys should be gone
    const aliceKey = await table.connect(alice).getMyEncryptedKey(key);
    const bobKey   = await table.connect(bob).getMyEncryptedKey(key);
    expect(aliceKey).to.equal('0x');
    expect(bobKey).to.equal('0x');
  });

  it('reading a deleted record reverts', async () => {
    const { table } = await deployStack();

    const key    = randKey();
    const cipher = mockCiphertext({ id: 8 });
    const eKey   = mockEncKey('owner');

    await (await table.write(key, toBytes(cipher), toBytes(eKey))).wait();
    await (await table.deleteRecord(key)).wait();

    await expect(table.read(key)).to.be.revertedWith(/deleted|NotFound/i);
  });

  it('only owner can delete', async () => {
    const { table, alice } = await deployStack();

    const key    = randKey();
    const cipher = mockCiphertext({ id: 9 });
    const eKey   = mockEncKey('owner');

    await (await table.write(key, toBytes(cipher), toBytes(eKey))).wait();

    await expect(table.connect(alice).deleteRecord(key)).to.be.reverted;
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Web3QLTable — record metadata helpers', () => {
  it('recordExists returns false for unknown key', async () => {
    const { table } = await deployStack();
    expect(await table.recordExists(randKey())).to.be.false;
  });

  it('recordOwner returns the writer', async () => {
    const { table, owner } = await deployStack();

    const key    = randKey();
    const cipher = mockCiphertext({ id: 10 });
    const eKey   = mockEncKey('owner');

    await (await table.write(key, toBytes(cipher), toBytes(eKey))).wait();
    const ret = await table.recordOwner(key);
    expect(ret).to.equal(owner.address);
  });
});
