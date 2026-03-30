/**
 * @file   compiler.test.ts
 * @notice Unit tests for the Web3QL compiler (parser + generator).
 *         No blockchain required — pure TypeScript.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCreateTable, parseSchema } from '../compiler/parser.js';
import { generateTable }                 from '../compiler/generator.js';
import { compileSchema }                 from '../compiler/index.js';

// ─────────────────────────────────────────────────────────────
//  Parser tests
// ─────────────────────────────────────────────────────────────

describe('parser — parseCreateTable', () => {

  it('parses a simple valid schema', () => {
    const ast = parseCreateTable(`
      CREATE TABLE users (
        id      INT  PRIMARY KEY,
        name    TEXT,
        balance INT
      );
    `);

    assert.equal(ast.table, 'users');
    assert.equal(ast.fields.length, 3);
    assert.equal(ast.fields[0].name,    'id');
    assert.equal(ast.fields[0].type,    'INT');
    assert.equal(ast.fields[0].primary, true);
    assert.equal(ast.fields[1].name,    'name');
    assert.equal(ast.fields[1].primary, false);
  });

  it('parses all supported types', () => {
    const ast = parseCreateTable(`
      CREATE TABLE things (
        id    INT     PRIMARY KEY,
        label TEXT,
        flag  BOOL,
        addr  ADDRESS,
        price FLOAT
      );
    `);
    const types = ast.fields.map((f) => f.type);
    assert.deepEqual(types, ['INT', 'TEXT', 'BOOL', 'ADDRESS', 'FLOAT']);
  });

  it('is case-insensitive for keywords and types', () => {
    const ast = parseCreateTable(
      'create table widgets ( id int primary key, name text );'
    );
    assert.equal(ast.table, 'widgets');
    assert.equal(ast.fields[0].type, 'INT');
  });

  it('strips -- comments', () => {
    const ast = parseCreateTable(`
      -- this is a comment
      CREATE TABLE items (
        id INT PRIMARY KEY, -- pk
        val TEXT            -- value
      );
    `);
    assert.equal(ast.fields.length, 2);
  });

  it('throws when no PRIMARY KEY defined', () => {
    assert.throws(
      () => parseCreateTable('CREATE TABLE bad ( id INT, name TEXT );'),
      /PRIMARY KEY/
    );
  });

  it('throws when primary key is not INT', () => {
    assert.throws(
      () => parseCreateTable('CREATE TABLE bad ( id TEXT PRIMARY KEY );'),
      /INT/
    );
  });

  it('throws on unsupported type', () => {
    assert.throws(
      () => parseCreateTable('CREATE TABLE bad ( id INT PRIMARY KEY, x JSON );'),
      /Unsupported type/
    );
  });

  it('throws on multiple primary keys', () => {
    assert.throws(
      () => parseCreateTable(
        'CREATE TABLE bad ( id INT PRIMARY KEY, id2 INT PRIMARY KEY );'
      ),
      /PRIMARY KEY/
    );
  });

  it('throws on empty table body', () => {
    assert.throws(
      () => parseCreateTable('CREATE TABLE empty ();'),
      /at least one column/
    );
  });
});

describe('parser — parseSchema (multi-table)', () => {
  it('parses two tables from one schema string', () => {
    const asts = parseSchema(`
      CREATE TABLE users ( id INT PRIMARY KEY, name TEXT );
      CREATE TABLE posts ( id INT PRIMARY KEY, title TEXT );
    `);
    assert.equal(asts.length, 2);
    assert.equal(asts[0].table, 'users');
    assert.equal(asts[1].table, 'posts');
  });
});

// ─────────────────────────────────────────────────────────────
//  Generator tests
// ─────────────────────────────────────────────────────────────

describe('generator — generateTable', () => {
  const ast = parseCreateTable(`
    CREATE TABLE users (
      id      INT  PRIMARY KEY,
      name    TEXT,
      balance INT
    );
  `);

  it('produces correct contractName', () => {
    const out = generateTable(ast);
    assert.equal(out.contractName, 'UsersTable');
  });

  it('generates deterministic Solidity (same input → same output)', () => {
    const a = generateTable(ast).solidity;
    const b = generateTable(ast).solidity;
    assert.equal(a, b);
  });

  it('Solidity contains correct contract name', () => {
    const { solidity } = generateTable(ast);
    assert.ok(solidity.includes('contract UsersTable is Web3QLTable'));
  });

  it('Solidity contains keccak256 key derivation', () => {
    const { solidity } = generateTable(ast);
    assert.ok(solidity.includes('keccak256(abi.encodePacked("users"'));
  });

  it('Solidity contains all expected functions', () => {
    const { solidity } = generateTable(ast);
    for (const fn of ['insert', 'readRecord', 'updateRecord', 'deleteRecordById',
                      'grantRecordAccess', 'revokeRecordAccess', 'getEncryptedKey']) {
      assert.ok(solidity.includes(`function ${fn}`), `Missing function: ${fn}`);
    }
  });

  it('generates ABI with expected function names', () => {
    const { abi } = generateTable(ast);
    const names = abi.filter((x) => x.type === 'function').map((x) => x.name!);
    for (const fn of ['insert', 'readRecord', 'updateRecord', 'deleteRecordById',
                      'grantRecordAccess', 'revokeRecordAccess', 'getEncryptedKey',
                      'recordExists', 'recordOwner']) {
      assert.ok(names.includes(fn), `ABI missing function: ${fn}`);
    }
  });

  it('SDK bindings contain the client class', () => {
    const { sdkBindings } = generateTable(ast);
    assert.ok(sdkBindings.includes('class UsersTableClient'));
    assert.ok(sdkBindings.includes('async insert('));
    assert.ok(sdkBindings.includes('async readRaw('));
    assert.ok(sdkBindings.includes('async grantAccess('));
  });

  it('schemaBytes is a valid hex string', () => {
    const { schemaBytes } = generateTable(ast);
    assert.ok(schemaBytes.startsWith('0x'), 'schemaBytes should start with 0x');
    assert.ok(schemaBytes.length > 2,       'schemaBytes should not be empty');
  });
});

// ─────────────────────────────────────────────────────────────
//  Full pipeline test
// ─────────────────────────────────────────────────────────────

describe('compileSchema — full pipeline', () => {
  it('compiles a two-table schema end-to-end', () => {
    const results = compileSchema(`
      CREATE TABLE users (
        id   INT  PRIMARY KEY,
        name TEXT
      );
      CREATE TABLE posts (
        id    INT  PRIMARY KEY,
        title TEXT
      );
    `);

    assert.equal(results.length, 2);
    assert.equal(results[0].contractName, 'UsersTable');
    assert.equal(results[1].contractName, 'PostsTable');
    assert.ok(results[0].abi.length > 0);
    assert.ok(results[0].solidity.length > 0);
    assert.ok(results[0].sdkBindings.length > 0);
  });
});
