// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Web3QLAccess.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title  Web3QLTable
 * @notice Per-table encrypted record storage.
 *
 *         Storage model:
 *           - One symmetric key per record (AES-256 / ChaCha20, chosen off-chain).
 *           - Each authorised user holds their own copy of the symmetric key,
 *             encrypted with their public key (ECIES / NaCl box off-chain).
 *           - Ciphertext is stored once — never rewritten on share/revoke.
 *           - Maximum MAX_COLLABORATORS per record (gas bound on delete).
 *
 *         UUPS-upgradeable so the database owner can upgrade table logic
 *         without redeploying or migrating data.
 *
 * @dev    Deployed by Web3QLDatabase.createTable().
 *         The deploying database contract is the Ownable owner.
 */
contract Web3QLTable is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    Web3QLAccess
{
    // ─────────────────────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────────────────────

    /// Maximum collaborators per record (owner + MAX_COLLABORATORS - 1 others).
    uint8 public constant MAX_COLLABORATORS = 10;

    // ─────────────────────────────────────────────────────────────
    //  Types
    // ─────────────────────────────────────────────────────────────

    /**
     * @dev Packed into 2 storage slots (was 5):
     *      Slot 0: pointer to dynamic `ciphertext` bytes.
     *      Slot 1: address(20) + bool(1) + uint32(4) + uint48(6) + uint8(1) = 32 bytes.
     *      Saves ~60k gas per write vs the unpacked layout.
     */
    struct RecordMeta {
        bytes   ciphertext;        // slot 0 — pointer to dynamic bytes
        address owner;             // slot 1 — 20 bytes
        bool    deleted;           //           1 byte
        uint32  version;           //           4 bytes  (max ~4B versions)
        uint48  updatedAt;         //           6 bytes  (valid past year 10 000)
        uint8   collaboratorCount; //           1 byte  (total: 32 B — 1 slot)
    }

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    /// Human-readable table name (set on init).
    string public tableName;

    /// Schema bytes — ABI-encoded AST stored for introspection / SDK codegen.
    bytes public schemaBytes;

    /// Core record metadata.
    mapping(bytes32 => RecordMeta) internal _records;

    /// Per-record, per-user encrypted symmetric key.
    mapping(bytes32 => mapping(address => bytes)) internal _encryptedKeys;

    /// Ordered collaborator list (owner at index 0) — used for delete sweep.
    mapping(bytes32 => address[]) internal _collaborators;

    /// Total unique record keys ever created (never decremented).
    uint256 public totalRecords;

    /// Current non-deleted record count.
    uint256 public activeRecords;

    /// Table-level writer allowlist. Only enforced when restrictedWrites = true.
    mapping(address => bool) public tableWriters;

    /// When true, only addresses in tableWriters may call write().
    /// Defaults to false — open/public table (anyone can write).
    bool public restrictedWrites;

    /// Owner → append-only list of record keys they have written.
    mapping(address => bytes32[]) private _ownerKeys;

    /// O(1) dedup guard — prevents linear scan on key reuse after delete.
    mapping(address => mapping(bytes32 => bool)) private _ownerKeyListed;

    /// When true, only record owners/collaborators and the table admin can read.
    bool public gatedRead;

    /// Monotonically increasing schema version. Starts at 0 on deploy.
    uint32 public schemaVersion;

    // ─── Counter / Relation state ────────────────────────────────

    /// Public counters: targetKey => field (bytes32 of field name) => value.
    /// Only authorised RelationWire contracts can increment these.
    mapping(bytes32 => mapping(bytes32 => uint256)) public counters;

    /// Authorised incrementers: wire address => field => allowed.
    mapping(address => mapping(bytes32 => bool)) public wireCanIncrement;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event RecordWritten(bytes32 indexed key, address indexed owner, uint256 version, uint256 updatedAt);
    event RecordUpdated(bytes32 indexed key, address indexed actor, uint256 version, uint256 updatedAt);
    event RecordDeleted(bytes32 indexed key, address indexed owner, uint256 version, uint256 updatedAt);
    event AccessGranted(bytes32 indexed key, address indexed user, Web3QLAccess.Role role);
    event AccessRevoked(bytes32 indexed key, address indexed user);
    event CounterUpdated(bytes32 indexed targetKey, bytes32 indexed field, uint256 newValue);
    event WireRegistered(address indexed wire, bytes32[] fields);
    event WireRevoked(address indexed wire, bytes32[] fields);
    event TableWriterAdded(address indexed writer);
    event TableWriterRemoved(address indexed writer);
    event RestrictedWritesUpdated(bool restricted);
    event SchemaUpdated(uint32 indexed version, bytes newSchemaBytes);
    event GatedReadUpdated(bool gated);

    // ─────────────────────────────────────────────────────────────
    //  Initializer (replaces constructor for UUPS proxy)
    // ─────────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _owner,
        string  calldata _tableName,
        bytes   calldata _schemaBytes
    ) external initializer {
        __Ownable_init(_owner);
        tableName   = _tableName;
        schemaBytes = _schemaBytes;
    }

    function _authorizeUpgrade(address newImpl) internal override onlyOwner {}

    // ─────────────────────────────────────────────────────────────
    //  Write
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Store a new encrypted record.
     * @param key           keccak256(abi.encodePacked(tableName, primaryKeyValue))
     * @param ciphertext    AES-256 / ChaCha20 encrypted payload.
     * @param encryptedKey  Symmetric key encrypted with the caller's public key.
     */
    function write(
        bytes32 key,
        bytes calldata ciphertext,
        bytes calldata encryptedKey
    ) external {
        if (restrictedWrites) {
            require(tableWriters[msg.sender], "Web3QLTable: not an authorized writer");
        }
        RecordMeta storage rec = _records[key];
        require(
            rec.owner == address(0) || rec.deleted,
            "Web3QLTable: record already exists"
        );
        require(ciphertext.length  > 0, "Web3QLTable: empty ciphertext");
        require(encryptedKey.length > 0, "Web3QLTable: empty encryptedKey");

        bool isNew       = (rec.owner == address(0));
        bool wasDeleted  = rec.deleted; // capture before mutation

        if (wasDeleted) {
            // Reuse slot — reset collaborator list
            delete _collaborators[key];
        }

        rec.ciphertext          = ciphertext;
        rec.owner               = msg.sender;
        rec.deleted             = false;
        rec.version             += 1;
        rec.updatedAt           = uint48(block.timestamp);
        rec.collaboratorCount   = 1;

        _encryptedKeys[key][msg.sender] = encryptedKey;
        _collaborators[key].push(msg.sender);

        if (isNew) {
            totalRecords++;
        }
        // O(1) dedup: append to _ownerKeys only once per (owner, key) pair.
        if (!_ownerKeyListed[msg.sender][key]) {
            _ownerKeys[msg.sender].push(key);
            _ownerKeyListed[msg.sender][key] = true;
        }
        activeRecords++;

        // Grant OWNER role scoped to this record key
        _setOwner(key, msg.sender);

        emit RecordWritten(key, msg.sender, rec.version, rec.updatedAt);
    }

    // ─────────────────────────────────────────────────────────────
    //  Read
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Returns ciphertext and record metadata.
     *         Ciphertext is publicly visible on-chain; decrypt off-chain.
     */
    function read(bytes32 key)
        external view
        returns (
            bytes memory ciphertext,
            bool         deleted,
            uint256      version,
            uint256      updatedAt,
            address      owner_
        )
    {
        if (gatedRead) {
            require(
                _records[key].owner == msg.sender ||
                hasRole(key, msg.sender, Role.VIEWER) ||
                msg.sender == owner(),
                "Web3QLTable: read access denied"
            );
        }
        RecordMeta storage rec = _records[key];
        return (rec.ciphertext, rec.deleted, rec.version, rec.updatedAt, rec.owner);
    }

    /**
     * @notice Returns the caller's encrypted key copy.
     *         Empty bytes if caller is not authorised.
     */
    function getMyEncryptedKey(bytes32 key) external view returns (bytes memory) {
        if (
            _records[key].owner == msg.sender ||
            hasRole(key, msg.sender, Role.VIEWER)
        ) {
            return _encryptedKeys[key][msg.sender];
        }
        return "";
    }

    // ─────────────────────────────────────────────────────────────
    //  Update
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Update ciphertext and the caller's encrypted key copy.
     *         For full key rotation: call this then grantAccess for each collaborator.
     * @param expectedVersion  Pass the version you read to enable optimistic locking.
     *                         Pass 0 to skip the check (last-writer-wins).
     */
    function update(
        bytes32 key,
        bytes calldata ciphertext,
        bytes calldata encryptedKey,
        uint32 expectedVersion
    ) external {
        require(
            _records[key].owner == msg.sender || hasRole(key, msg.sender, Role.EDITOR),
            "Web3QLTable: write permission denied"
        );
        RecordMeta storage rec = _records[key];
        require(!rec.deleted, "Web3QLTable: record deleted");
        require(ciphertext.length  > 0, "Web3QLTable: empty ciphertext");
        require(encryptedKey.length > 0, "Web3QLTable: empty encryptedKey");

        if (expectedVersion != 0) {
            require(rec.version == expectedVersion, "Web3QLTable: version conflict");
        }

        rec.ciphertext  = ciphertext;
        rec.version    += 1;
        rec.updatedAt   = uint48(block.timestamp);
        _encryptedKeys[key][msg.sender] = encryptedKey;

        emit RecordUpdated(key, msg.sender, rec.version, rec.updatedAt);
    }

    // ─────────────────────────────────────────────────────────────
    //  Delete
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Soft-delete.
     *         Overwrites EVERY collaborator's encrypted key copy with garbage
     *         (derived from prevrandao) so the symmetric key is unrecoverable
     *         from on-chain data.  The ciphertext slab remains (blockchain is
     *         immutable) but is permanently unreadable.
     *         Clears the collaborator list to reclaim storage gas.
     */
    function deleteRecord(bytes32 key) external {
        RecordMeta storage rec = _records[key];
        require(rec.owner == msg.sender, "Web3QLTable: not record owner");
        require(!rec.deleted,            "Web3QLTable: already deleted");

        address[] storage collab = _collaborators[key];
        uint256 len = collab.length;
        for (uint256 i = 0; i < len; ) {
            _encryptedKeys[key][collab[i]] = abi.encodePacked(
                keccak256(abi.encodePacked(key, block.prevrandao, collab[i], rec.version))
            );
            unchecked { ++i; }
        }
        delete _collaborators[key];

        rec.deleted             = true;
        rec.version            += 1;
        rec.updatedAt           = uint48(block.timestamp);
        rec.collaboratorCount   = 0;
        activeRecords--;

        emit RecordDeleted(key, msg.sender, rec.version, rec.updatedAt);
    }

    // ─────────────────────────────────────────────────────────────
    //  Access control
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Grant another user access to this record.
     * @param key               Record key.
     * @param user              Recipient (collaborator or recovery address).
     * @param role              VIEWER (read-only) or EDITOR (read+write).
     * @param encryptedKeyForUser Symmetric key encrypted with recipient's pubkey.
     */
    function grantAccess(
        bytes32 key,
        address user,
        Role    role,
        bytes calldata encryptedKeyForUser
    ) external {
        RecordMeta storage rec = _records[key];
        require(rec.owner == msg.sender,  "Web3QLTable: not record owner");
        require(!rec.deleted,             "Web3QLTable: record deleted");
        require(user != address(0),       "Web3QLTable: zero address");
        require(user != msg.sender,       "Web3QLTable: user is owner");
        require(role == Role.VIEWER || role == Role.EDITOR, "Web3QLTable: invalid role");
        require(encryptedKeyForUser.length > 0, "Web3QLTable: empty encryptedKey");
        require(
            rec.collaboratorCount < MAX_COLLABORATORS,
            "Web3QLTable: max collaborators reached"
        );

        if (_encryptedKeys[key][user].length == 0) {
            _collaborators[key].push(user);
            rec.collaboratorCount += 1;
        }

        _encryptedKeys[key][user] = encryptedKeyForUser;

        // Use Web3QLAccess internal helper (bypasses the onlyResourceOwner check
        // since we already checked ownership above)
        _grantRole(key, user, role);

        emit AccessGranted(key, user, role);
    }

    /**
     * @notice Revoke a user's access and scrub their encrypted key copy.
     */
    function revokeAccess(bytes32 key, address user) external {
        require(_records[key].owner == msg.sender, "Web3QLTable: not record owner");
        require(user != _records[key].owner,       "Web3QLTable: cannot revoke owner");

        // Scrub key material
        _encryptedKeys[key][user] = abi.encodePacked(
            keccak256(abi.encodePacked(key, block.prevrandao, user))
        );

        // Remove from collaborator array (swap-and-pop)
        address[] storage collab = _collaborators[key];
        uint256 len = collab.length;
        for (uint256 i = 0; i < len; ) {
            if (collab[i] == user) {
                collab[i] = collab[len - 1];
                collab.pop();
                _records[key].collaboratorCount -= 1;
                break;
            }
            unchecked { ++i; }
        }

        _revokeRole(key, user);

        emit AccessRevoked(key, user);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function recordExists(bytes32 key) external view returns (bool) {
        RecordMeta storage rec = _records[key];
        return rec.owner != address(0) && !rec.deleted;
    }

    function collaboratorCount(bytes32 key) external view returns (uint8) {
        return _records[key].collaboratorCount;
    }

    function getCollaborators(bytes32 key) external view returns (address[] memory) {
        return _collaborators[key];
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

    /**
     * @notice Like getOwnerRecords but filters out soft-deleted records.
     *         More expensive (reads each RecordMeta) but avoids wasted SDK
     *         decrypt calls on deleted keys.
     */
    function getActiveOwnerRecords(
        address addr,
        uint256 start,
        uint256 limit
    ) external view returns (bytes32[] memory result) {
        bytes32[] storage keys = _ownerKeys[addr];
        uint256 total = keys.length;

        // First pass: count matching active records from `start`
        uint256 seen   = 0;
        uint256 count  = 0;
        for (uint256 i = 0; i < total && count < limit; ) {
            if (!_records[keys[i]].deleted && _records[keys[i]].owner == addr) {
                if (seen >= start) count++;
                seen++;
            }
            unchecked { ++i; }
        }

        result = new bytes32[](count);
        uint256 idx    = 0;
        uint256 seen2  = 0;
        for (uint256 i = 0; i < total && idx < count; ) {
            if (!_records[keys[i]].deleted && _records[keys[i]].owner == addr) {
                if (seen2 >= start) result[idx++] = keys[i];
                seen2++;
            }
            unchecked { ++i; }
        }
    }

    function tableKey() external view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this)));
    }

    // ─────────────────────────────────────────────────────────────
    //  Schema management
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Update the table schema. Only the table owner may call this.
     *         Increments schemaVersion so SDK clients can stamp __v on writes.
     *         Does NOT re-validate existing records — use MigrationRunner for that.
     */
    function updateSchema(bytes calldata newSchemaBytes) external onlyOwner {
        require(newSchemaBytes.length > 0, "Web3QLTable: empty schema");
        schemaBytes    = newSchemaBytes;
        schemaVersion += 1;
        emit SchemaUpdated(schemaVersion, newSchemaBytes);
    }

    /**
     * @notice Toggle gated reads.
     *         When true, only record owner, collaborators, and table admin can read.
     *         When false (default), ciphertext is visible to anyone (decrypt off-chain).
     */
    function setGatedRead(bool _gated) external onlyOwner {
        gatedRead = _gated;
        emit GatedReadUpdated(_gated);
    }

    // ─────────────────────────────────────────────────────────────
    //  Security: block inherited role bypass paths
    // ─────────────────────────────────────────────────────────────

    /// @notice Disabled — use grantAccess() which stores the encrypted key.
    function grantRole(bytes32, address, Role) external pure override {
        revert("Web3QLTable: use grantAccess()");
    }

    /// @notice Disabled — use revokeAccess() which scrubs the encrypted key.
    function revokeRole(bytes32, address) external pure override {
        revert("Web3QLTable: use revokeAccess()");
    }

    // ─────────────────────────────────────────────────────────────
    //  Counter / Relation API
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Register a RelationWire as authorised to increment specific counter fields.
     *         Only the table owner can call this.  Safe to call after records exist.
     * @param wire    Address of the deployed Web3QLRelationWire.
     * @param fields  Array of field name hashes: keccak256(abi.encodePacked(fieldName)).
     */
    function registerWire(address wire, bytes32[] calldata fields) external onlyOwner {
        require(wire != address(0), "Web3QLTable: zero wire address");
        uint256 len = fields.length;
        for (uint256 i = 0; i < len; ) {
            wireCanIncrement[wire][fields[i]] = true;
            unchecked { ++i; }
        }
        emit WireRegistered(wire, fields);
    }

    /**
     * @notice Remove a wire's increment permission for given fields.
     */
    function revokeWire(address wire, bytes32[] calldata fields) external onlyOwner {
        uint256 len = fields.length;
        for (uint256 i = 0; i < len; ) {
            wireCanIncrement[wire][fields[i]] = false;
            unchecked { ++i; }
        }
        emit WireRevoked(wire, fields);
    }

    // ─────────────────────────────────────────────────────────────
    //  Table-level write access control
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Add an address to the table-level writer allowlist.
     *         Only has effect when restrictedWrites = true.
     */
    function addTableWriter(address writer) external onlyOwner {
        require(writer != address(0), "Web3QLTable: zero address");
        tableWriters[writer] = true;
        emit TableWriterAdded(writer);
    }

    /**
     * @notice Remove an address from the table-level writer allowlist.
     */
    function removeTableWriter(address writer) external onlyOwner {
        tableWriters[writer] = false;
        emit TableWriterRemoved(writer);
    }

    /**
     * @notice Toggle restricted write mode.
     *         false (default) = open/public table — anyone can write.
     *         true            = only tableWriters allowlist can write.
     */
    function setRestrictedWrites(bool restricted) external onlyOwner {
        restrictedWrites = restricted;
        emit RestrictedWritesUpdated(restricted);
    }

    /**
     * @notice Increment a counter field on a given record key.
     *         Only callable by a registered RelationWire contract.
     * @param targetKey  The record key (same bytes32 used for the target record).
     * @param field      keccak256(abi.encodePacked(fieldName)).
     * @param amount     Value to add (for payments: pass msg.value; for counts: pass 1).
     */
    function increment(bytes32 targetKey, bytes32 field, uint256 amount) external {
        require(wireCanIncrement[msg.sender][field], "Web3QLTable: caller not a registered wire");
        counters[targetKey][field] += amount;
        emit CounterUpdated(targetKey, field, counters[targetKey][field]);
    }

    /**
     * @notice Read a counter value.  Public — no auth required.
     */
    function counterValue(bytes32 targetKey, bytes32 field) external view returns (uint256) {
        return counters[targetKey][field];
    }

    /**
     * @notice Returns the owner address of a record.
     *         Used by RelationWire.withdrawProjectFunds() to verify the caller
     *         is the project owner before releasing accumulated payments.
     *         Returns address(0) if the record has never been written.
     */
    function recordOwner(bytes32 key) external view returns (address) {
        return _records[key].owner;
    }
}
