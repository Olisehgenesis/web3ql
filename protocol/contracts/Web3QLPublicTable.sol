// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Web3QLAccess.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title  Web3QLPublicTable
 * @notice Per-table plaintext (unencrypted) record storage with on-chain
 *         schema validation and two-level write authority.
 *
 *         Access model:
 *           - By default (restrictedWrites = false) ANY address may write.
 *           - The writer of a record becomes its OWNER:
 *               • can update their own record
 *               • can delete their own record
 *               • can grant/revoke EDITOR role on their record
 *           - The table admin (Ownable owner()) has override authority:
 *               • can update ANY record
 *               • can delete ANY record
 *               • can grant/revoke EDITOR on ANY record
 *               • can toggle restrictedWrites + manage tableWriters allowlist
 *               • can update the schema
 *           - EDITOR role (per-record): can update that record, NOT delete.
 *           - Anyone can read (data is public plaintext — no auth required).
 *
 *         Schema validation (on-chain):
 *           - Schema is stored as ABI-encoded FieldInfo[] on-chain.
 *           - Required field hashes (keccak256(fieldName) for notNull,
 *             non-primaryKey fields) are cached in _requiredFieldHashes.
 *           - write() and update() must supply fieldKeys covering every
 *             required field — contract reverts otherwise.
 *
 *         Gas vs Web3QLTable (private):
 *           - No encryptedKey SSTORE            (-20k gas per write)
 *           - No collaborator list push         (-20k gas per write)
 *           - No per-user key mapping           (-20k gas per share)
 *           - Packed struct (uint32+uint48)     (-20k gas per write)
 *           - delete clears data bytes          (storage refund on delete)
 *           Typical saving: ~80-100k gas per write vs private table.
 *
 * @dev    Deployed by Web3QLDatabase.createTable() with TableType.PUBLIC.
 *         Shares the UUPS upgradeable pattern with Web3QLTable.
 */
contract Web3QLPublicTable is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    Web3QLAccess
{
    // ─────────────────────────────────────────────────────────────
    //  Types
    // ─────────────────────────────────────────────────────────────

    /**
     * @dev Mirrors FieldDescriptor in protocol/compiler/types.ts.
     *      Must match the ABI encoding the SDK produces for schemaBytes.
     */
    struct FieldInfo {
        string name;
        string solidityType;
        bool   primaryKey;
        bool   notNull;
    }

    /**
     * @dev Packed to fit in 2 storage slots:
     *      Slot 0: pointer to dynamic `data` bytes (always 1 slot for dynamic types)
     *      Slot 1: address(20) + bool(1) + uint32(4) + uint48(6) = 31 bytes — fits in 1 slot
     */
    struct PublicRecord {
        bytes   data;       // slot 0 — plaintext payload
        address owner;      // slot 1 — 20 bytes
        bool    deleted;    //           1 byte
        uint32  version;    //           4 bytes  (max ~4B versions)
        uint48  updatedAt;  //           6 bytes  (unix seconds; good past year 10 000)
    }

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    /// Human-readable table name (immutable after init).
    string  public tableName;

    /// ABI-encoded FieldInfo[] — stored for SDK introspection / codegen.
    bytes   public schemaBytes;

    /// Monotonically increasing schema version.  Starts at 0 on deploy.
    uint32  public schemaVersion;

    /// Core record store.
    mapping(bytes32 => PublicRecord) internal _records;

    /**
     * @dev Precomputed from schemaBytes on init and every updateSchema().
     *      Contains keccak256(fieldName) for every field where
     *      notNull == true AND primaryKey == false.
     *      Validated against fieldKeys on every write/update.
     */
    bytes32[] internal _requiredFieldHashes;

    /// Packed record counters (saves 1 slot vs two uint256s).
    uint128 public totalRecords;
    uint128 public activeRecords;

    /// Writer allowlist — only consulted when restrictedWrites == true.
    mapping(address => bool) public tableWriters;

    /**
     * @notice When false (default): any address can write.
     *         When true: only tableWriters + owner() can write.
     */
    bool public restrictedWrites;

    /// owner → append-only ordered list of record keys they created.
    mapping(address => bytes32[]) private _ownerKeys;

    /// O(1) dedup guard — prevents linear scan on key reuse after delete.
    mapping(address => mapping(bytes32 => bool)) private _ownerKeyListed;

    // ── Counter / RelationWire state (mirrors Web3QLTable) ───────

    /// Public counters — only authorised RelationWire contracts may increment.
    mapping(bytes32 => mapping(bytes32 => uint256)) public counters;

    /// wire address → field hash → allowed to increment.
    mapping(address => mapping(bytes32 => bool)) public wireCanIncrement;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event RecordWritten(bytes32 indexed key, address indexed writer,  uint32 version, uint48 updatedAt);
    event RecordUpdated(bytes32 indexed key, address indexed actor,   uint32 version, uint48 updatedAt);
    event RecordDeleted(bytes32 indexed key, address indexed actor,   uint32 version, uint48 updatedAt);
    event SchemaUpdated(uint32 indexed version, bytes newSchemaBytes);
    event AccessGranted(bytes32 indexed key, address indexed user, Web3QLAccess.Role role);
    event AccessRevoked(bytes32 indexed key, address indexed user);
    event TableWriterAdded(address indexed writer);
    event TableWriterRemoved(address indexed writer);
    event RestrictedWritesUpdated(bool restricted);
    event CounterUpdated(bytes32 indexed targetKey, bytes32 indexed field, uint256 newValue);
    event WireRegistered(address indexed wire, bytes32[] fields);
    event WireRevoked(address indexed wire, bytes32[] fields);

    // ─────────────────────────────────────────────────────────────
    //  Initializer
    // ─────────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    /**
     * @param _owner       Database owner (becomes table admin).
     * @param _tableName   Human-readable table name.
     * @param _schemaBytes ABI-encoded FieldInfo[] from the SDK compiler.
     *
     * @dev  restrictedWrites intentionally defaults to false so public
     *       tables accept writes from any address on creation.
     */
    function initialize(
        address _owner,
        string  calldata _tableName,
        bytes   calldata _schemaBytes
    ) external initializer {
        __Ownable_init(_owner);
        tableName   = _tableName;
        schemaBytes = _schemaBytes;
        // restrictedWrites = false (EVM zero default) — open writes
        _computeRequiredFields(_schemaBytes);
    }

    function _authorizeUpgrade(address newImpl) internal override onlyOwner {}

    // ─────────────────────────────────────────────────────────────
    //  Schema
    // ─────────────────────────────────────────────────────────────

    /**
     * @dev Decode schemaBytes and populate _requiredFieldHashes.
     *      Called once on initialize and again after every updateSchema.
     *      An empty or unparseable schema silently produces 0 required fields.
     */
    function _computeRequiredFields(bytes calldata schema) internal {
        // Reset the cache
        delete _requiredFieldHashes;
        if (schema.length == 0) return;

        // abi.decode with a statically-defined tuple type that matches the
        // SDK's ABI encoding: tuple(string,string,bool,bool)[]
        FieldInfo[] memory fields = abi.decode(schema, (FieldInfo[]));
        uint256 len = fields.length;
        for (uint256 i; i < len; ) {
            // A field is "required" when it is NOT NULL and NOT the primary key.
            // Primary keys are enforced structurally (unique record key slot),
            // so they need no separate required-field check here.
            if (fields[i].notNull && !fields[i].primaryKey) {
                _requiredFieldHashes.push(keccak256(bytes(fields[i].name)));
            }
            unchecked { ++i; }
        }
    }

    /**
     * @notice Update the table schema.  Only the table admin may call this.
     *         Increments schemaVersion and rebuilds the required-field cache.
     *
     * @dev  Schema changes do NOT re-validate existing records.  Use the SDK
     *       MigrationRunner for lazy or explicit migration of existing data.
     */
    function updateSchema(bytes calldata newSchemaBytes) external onlyOwner {
        require(newSchemaBytes.length > 0, "Web3QLPublicTable: empty schema");
        schemaBytes   = newSchemaBytes;
        schemaVersion += 1;
        _computeRequiredFields(newSchemaBytes);
        emit SchemaUpdated(schemaVersion, newSchemaBytes);
    }

    // ─────────────────────────────────────────────────────────────
    //  Internal auth helpers
    // ─────────────────────────────────────────────────────────────

    function _canWrite() internal view returns (bool) {
        // Open write (default) OR in the allowlist OR table admin
        return !restrictedWrites
            || tableWriters[msg.sender]
            || msg.sender == owner();
    }

    function _canModifyRecord(bytes32 key) internal view returns (bool) {
        // Record owner, per-record EDITOR, or table admin override
        return _records[key].owner == msg.sender
            || hasRole(key, msg.sender, Role.EDITOR)
            || msg.sender == owner();
    }

    function _canDeleteRecord(bytes32 key) internal view returns (bool) {
        // Only record owner or table admin (EDITOR alone cannot delete)
        return _records[key].owner == msg.sender
            || msg.sender == owner();
    }

    // ─────────────────────────────────────────────────────────────
    //  Schema validation
    // ─────────────────────────────────────────────────────────────

    /**
     * @dev Check that every required field hash appears in fieldKeys.
     *      fieldKeys must contain keccak256(abi.encodePacked(fieldName))
     *      for every field being written.  The SDK computes these.
     *      Complexity: O(requiredFields × fieldKeys.length).
     *      For typical schemas (< 20 fields) this is negligible.
     */
    function _validateRequiredFields(bytes32[] calldata fieldKeys) internal view {
        uint256 reqLen = _requiredFieldHashes.length;
        if (reqLen == 0) return;

        for (uint256 i; i < reqLen; ) {
            bool found = false;
            for (uint256 j; j < fieldKeys.length; ) {
                if (fieldKeys[j] == _requiredFieldHashes[i]) {
                    found = true;
                    break;
                }
                unchecked { ++j; }
            }
            require(found, "Web3QLPublicTable: missing required field");
            unchecked { ++i; }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  Write
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Store a new plaintext record.
     *
     * @param key        bytes32 record key — keccak256(abi.encodePacked(tableName, primaryKeyValue)).
     *                   Computed off-chain by the SDK (deriveKey).
     * @param fieldKeys  keccak256(fieldName) for every field present in `data`.
     *                   The contract verifies all notNull fields are included.
     * @param data       Plaintext payload — JSON-encoded or ABI-encoded bytes.
     *
     * @dev  ANY address may call this when restrictedWrites == false (default).
     *       The caller becomes the record's OWNER (EDITOR-delete authority).
     *       The table admin (owner()) always retains override authority.
     */
    function write(
        bytes32           key,
        bytes32[] calldata fieldKeys,
        bytes     calldata data
    ) external {
        require(_canWrite(),           "Web3QLPublicTable: write not permitted");
        require(data.length > 0,       "Web3QLPublicTable: empty data");

        PublicRecord storage rec = _records[key];
        require(
            rec.owner == address(0) || rec.deleted,
            "Web3QLPublicTable: record already exists"
        );

        _validateRequiredFields(fieldKeys);

        bool isNew      = (rec.owner == address(0));
        bool wasDeleted = rec.deleted;

        rec.data      = data;
        rec.owner     = msg.sender;
        rec.deleted   = false;
        rec.version  += 1;
        rec.updatedAt = uint48(block.timestamp);

        // Track writer's record list — O(1) dedup via mapping
        if (isNew) {
            _ownerKeys[msg.sender].push(key);
            _ownerKeyListed[msg.sender][key] = true;
            totalRecords++;
        } else if (wasDeleted && !_ownerKeyListed[msg.sender][key]) {
            _ownerKeys[msg.sender].push(key);
            _ownerKeyListed[msg.sender][key] = true;
        }
        activeRecords++;

        // Assign OWNER role in the access-control layer
        _setOwner(key, msg.sender);

        emit RecordWritten(key, msg.sender, rec.version, rec.updatedAt);
    }

    // ─────────────────────────────────────────────────────────────
    //  Read (unrestricted — data is publicly visible)
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Read a record.  No access control — public table data is public.
     */
    function read(bytes32 key)
        external view
        returns (
            bytes  memory data,
            bool          deleted,
            uint32        version,
            uint48        updatedAt,
            address       owner_
        )
    {
        PublicRecord storage rec = _records[key];
        return (rec.data, rec.deleted, rec.version, rec.updatedAt, rec.owner);
    }

    // ─────────────────────────────────────────────────────────────
    //  Update
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Overwrite an existing live record.
     *
     * @param key             Record key.
     * @param fieldKeys       Required-field proof (same semantics as write).
     * @param data            New plaintext payload.
     * @param expectedVersion Pass rec.version to enable optimistic locking,
     *                        or 0 to skip the check (last-writer-wins).
     *
     * @dev  Authorised callers:
     *         • Record owner (original writer)
     *         • Per-record EDITOR (granted via grantEditor)
     *         • Table admin (owner())
     */
    function update(
        bytes32           key,
        bytes32[] calldata fieldKeys,
        bytes     calldata data,
        uint32            expectedVersion
    ) external {
        require(_canModifyRecord(key), "Web3QLPublicTable: not authorised to update");

        PublicRecord storage rec = _records[key];
        require(!rec.deleted,    "Web3QLPublicTable: record deleted");
        require(data.length > 0, "Web3QLPublicTable: empty data");

        if (expectedVersion != 0) {
            require(rec.version == expectedVersion, "Web3QLPublicTable: version conflict");
        }

        _validateRequiredFields(fieldKeys);

        rec.data      = data;
        rec.version  += 1;
        rec.updatedAt = uint48(block.timestamp);

        emit RecordUpdated(key, msg.sender, rec.version, rec.updatedAt);
    }

    // ─────────────────────────────────────────────────────────────
    //  Delete
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Soft-delete a record and clear its stored data bytes.
     *
     * @dev  Clearing `rec.data` triggers an EVM storage refund (~15k gas).
     *       No key-scrubbing is needed — data was always public.
     *       Only record owner or table admin may delete (EDITOR alone cannot).
     */
    function deleteRecord(bytes32 key) external {
        require(_canDeleteRecord(key), "Web3QLPublicTable: not authorised to delete");

        PublicRecord storage rec = _records[key];
        require(!rec.deleted, "Web3QLPublicTable: already deleted");

        delete rec.data;          // clear bytes → gas refund
        rec.deleted   = true;
        rec.version  += 1;
        rec.updatedAt = uint48(block.timestamp);
        activeRecords--;

        emit RecordDeleted(key, msg.sender, rec.version, rec.updatedAt);
    }

    // ─────────────────────────────────────────────────────────────
    //  Per-record access control
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Grant EDITOR role on a specific record to `user`.
     *         EDITOR can update the record but NOT delete it.
     *
     * @dev  Authorised callers: record owner or table admin.
     *       VIEWER role is omitted — reads are always open on a public table.
     */
    function grantEditor(bytes32 key, address user) external {
        require(
            _records[key].owner == msg.sender || msg.sender == owner(),
            "Web3QLPublicTable: not authorised to grant"
        );
        require(!_records[key].deleted, "Web3QLPublicTable: record deleted");
        require(user != address(0),     "Web3QLPublicTable: zero address");
        require(user != _records[key].owner, "Web3QLPublicTable: user is owner");

        // _adminGrantRole bypasses the Web3QLAccess ownership check —
        // auth has already been verified above (record owner or table admin).
        _adminGrantRole(key, user, Role.EDITOR);
        emit AccessGranted(key, user, Role.EDITOR);
    }

    /**
     * @notice Revoke EDITOR role from `user` on a record.
     */
    function revokeEditor(bytes32 key, address user) external {
        require(
            _records[key].owner == msg.sender || msg.sender == owner(),
            "Web3QLPublicTable: not authorised to revoke"
        );
        _adminRevokeRole(key, user);
        emit AccessRevoked(key, user);
    }

    // ─────────────────────────────────────────────────────────────
    //  Table-admin: writer management
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Toggle write access mode.
     *         false (default) = open writes — anyone can write.
     *         true            = allowlist only (tableWriters + owner).
     */
    function setRestrictedWrites(bool restricted) external onlyOwner {
        restrictedWrites = restricted;
        emit RestrictedWritesUpdated(restricted);
    }

    function addTableWriter(address writer) external onlyOwner {
        require(writer != address(0), "Web3QLPublicTable: zero address");
        tableWriters[writer] = true;
        emit TableWriterAdded(writer);
    }

    function removeTableWriter(address writer) external onlyOwner {
        tableWriters[writer] = false;
        emit TableWriterRemoved(writer);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function recordExists(bytes32 key) external view returns (bool) {
        PublicRecord storage rec = _records[key];
        return rec.owner != address(0) && !rec.deleted;
    }

    function recordOwner(bytes32 key) external view returns (address) {
        return _records[key].owner;
    }

    function ownerRecordCount(address addr) external view returns (uint256) {
        return _ownerKeys[addr].length;
    }

    function getOwnerRecords(
        address addr,
        uint256 start,
        uint256 limit
    ) external view returns (bytes32[] memory result) {
        bytes32[] storage keys = _ownerKeys[addr];
        uint256 end = start + limit;
        if (end > keys.length) end = keys.length;
        if (start >= end) return result;
        result = new bytes32[](end - start);
        for (uint256 i = start; i < end; ) {
            result[i - start] = keys[i];
            unchecked { ++i; }
        }
    }

    function getActiveOwnerRecords(
        address addr,
        uint256 start,
        uint256 limit
    ) external view returns (bytes32[] memory result) {
        bytes32[] storage keys = _ownerKeys[addr];
        uint256 total = keys.length;
        uint256 seen  = 0;
        uint256 count = 0;
        for (uint256 i; i < total && count < limit; ) {
            PublicRecord storage r = _records[keys[i]];
            if (!r.deleted && r.owner == addr) {
                if (seen >= start) count++;
                seen++;
            }
            unchecked { ++i; }
        }
        result = new bytes32[](count);
        uint256 idx   = 0;
        uint256 seen2 = 0;
        for (uint256 i; i < total && idx < count; ) {
            PublicRecord storage r = _records[keys[i]];
            if (!r.deleted && r.owner == addr) {
                if (seen2 >= start) result[idx++] = keys[i];
                seen2++;
            }
            unchecked { ++i; }
        }
    }

    /// @notice Returns the required field hashes for introspection/testing.
    function requiredFieldHashes() external view returns (bytes32[] memory) {
        return _requiredFieldHashes;
    }

    function tableKey() external view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this)));
    }

    // ─────────────────────────────────────────────────────────────
    //  Counters (RelationWire support)
    // ─────────────────────────────────────────────────────────────

    function incrementCounter(bytes32 targetKey, bytes32 field, uint256 amount) external {
        require(wireCanIncrement[msg.sender][field], "Web3QLPublicTable: wire not authorised");
        counters[targetKey][field] += amount;
        emit CounterUpdated(targetKey, field, counters[targetKey][field]);
    }

    function registerWire(address wire, bytes32[] calldata fields) external onlyOwner {
        for (uint256 i; i < fields.length; ) {
            wireCanIncrement[wire][fields[i]] = true;
            unchecked { ++i; }
        }
        emit WireRegistered(wire, fields);
    }

    function revokeWire(address wire, bytes32[] calldata fields) external onlyOwner {
        for (uint256 i; i < fields.length; ) {
            wireCanIncrement[wire][fields[i]] = false;
            unchecked { ++i; }
        }
        emit WireRevoked(wire, fields);
    }

    function counterValue(bytes32 targetKey, bytes32 field) external view returns (uint256) {
        return counters[targetKey][field];
    }
}
