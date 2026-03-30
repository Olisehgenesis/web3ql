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

    struct RecordMeta {
        bytes    ciphertext;
        address  owner;
        bool     deleted;
        uint256  version;
        uint256  updatedAt;
        uint8    collaboratorCount;
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

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event RecordWritten(bytes32 indexed key, address indexed owner, uint256 version, uint256 updatedAt);
    event RecordUpdated(bytes32 indexed key, address indexed actor, uint256 version, uint256 updatedAt);
    event RecordDeleted(bytes32 indexed key, address indexed owner, uint256 version, uint256 updatedAt);
    event AccessGranted(bytes32 indexed key, address indexed user, Web3QLAccess.Role role);
    event AccessRevoked(bytes32 indexed key, address indexed user);

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
        __UUPSUpgradeable_init();
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
        RecordMeta storage rec = _records[key];
        require(
            rec.owner == address(0) || rec.deleted,
            "Web3QLTable: record already exists"
        );
        require(ciphertext.length  > 0, "Web3QLTable: empty ciphertext");
        require(encryptedKey.length > 0, "Web3QLTable: empty encryptedKey");

        if (rec.deleted) {
            // Reuse slot — reset collaborator list
            delete _collaborators[key];
        }

        rec.ciphertext          = ciphertext;
        rec.owner               = msg.sender;
        rec.deleted             = false;
        rec.version             += 1;
        rec.updatedAt           = block.timestamp;
        rec.collaboratorCount   = 1;

        _encryptedKeys[key][msg.sender] = encryptedKey;
        _collaborators[key].push(msg.sender);

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
     */
    function update(
        bytes32 key,
        bytes calldata ciphertext,
        bytes calldata encryptedKey
    ) external {
        require(
            _records[key].owner == msg.sender || hasRole(key, msg.sender, Role.EDITOR),
            "Web3QLTable: write permission denied"
        );
        RecordMeta storage rec = _records[key];
        require(!rec.deleted, "Web3QLTable: record deleted");
        require(ciphertext.length  > 0, "Web3QLTable: empty ciphertext");
        require(encryptedKey.length > 0, "Web3QLTable: empty encryptedKey");

        rec.ciphertext  = ciphertext;
        rec.version     += 1;
        rec.updatedAt   = block.timestamp;
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
        rec.version             += 1;
        rec.updatedAt           = block.timestamp;
        rec.collaboratorCount   = 0;

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

    function tableKey() external view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this)));
    }
}
