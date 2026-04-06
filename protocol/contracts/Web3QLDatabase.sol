// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./Web3QLTable.sol";
import "./Web3QLPublicTable.sol";

/**
 * @title  Web3QLDatabase
 * @notice Per-user / per-project database contract.
 *         Manages a registry of named table contracts — either private
 *         (encrypted, Web3QLTable) or public (plaintext, Web3QLPublicTable).
 *
 *         Table types:
 *           PRIVATE — encrypted records, per-user key management, max 10 collaborators.
 *           PUBLIC  — plaintext records, open writes by default, on-chain schema validation.
 *
 * @dev    Deployed by Web3QLFactory.createDatabase() as a UUPS proxy.
 */
contract Web3QLDatabase is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    // ─────────────────────────────────────────────────────────────
    //  Types
    // ─────────────────────────────────────────────────────────────

    enum TableType { PRIVATE, PUBLIC }

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    /// Shared Web3QLTable (private) implementation — set by Factory on init.
    address public tableImplementation;

    /// Shared Web3QLPublicTable implementation — set by Factory on init.
    address public publicTableImplementation;

    /// Human-readable database name.
    string public databaseName;

    /// name → table proxy address
    mapping(string => address) public tables;

    /// name → table type (PRIVATE | PUBLIC)
    mapping(string => TableType) public tableTypes;

    /// Ordered list of table names for enumeration.
    string[] private _tableNames;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event TableCreated(
        string   indexed name,
        address           tableContract,
        address  indexed  owner,
        TableType         tableType
    );
    event TableDropped(string indexed name);

    // ─────────────────────────────────────────────────────────────
    //  Initializer
    // ─────────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _owner,
        address _tableImplementation,
        address _publicTableImplementation,
        string calldata _name
    ) external initializer {
        __Ownable_init(_owner);
        tableImplementation       = _tableImplementation;
        publicTableImplementation = _publicTableImplementation;
        databaseName              = _name;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─────────────────────────────────────────────────────────────
    //  Table management
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Deploy a new table for this database.
     *
     * @param name        Human-readable table name (unique within this database).
     * @param schemaBytes ABI-encoded FieldInfo[] for SDK codegen / on-chain validation.
     * @param tableType   TableType.PRIVATE (encrypted) or TableType.PUBLIC (plaintext).
     * @return tableAddr  Address of the deployed proxy.
     *
     * @dev  For PUBLIC tables:
     *         - restrictedWrites defaults to false (anyone can write).
     *         - On-chain required-field validation is active immediately.
     *         - No encryption keys are managed; reads are unrestricted.
     *       For PRIVATE tables:
     *         - Caller must supply encryptedKey on every write.
     *         - Only key holders can decrypt; ciphertext is public.
     */
    function createTable(
        string    calldata name,
        bytes     calldata schemaBytes,
        TableType          tableType
    ) external onlyOwner returns (address tableAddr) {
        require(bytes(name).length > 0,     "Web3QLDatabase: empty name");
        require(tables[name] == address(0), "Web3QLDatabase: table exists");
        require(schemaBytes.length > 0,     "Web3QLDatabase: empty schema");

        if (tableType == TableType.PUBLIC) {
            bytes memory initData = abi.encodeCall(
                Web3QLPublicTable.initialize,
                (owner(), name, schemaBytes)
            );
            tableAddr = address(new ERC1967Proxy(publicTableImplementation, initData));
        } else {
            bytes memory initData = abi.encodeCall(
                Web3QLTable.initialize,
                (owner(), name, schemaBytes)
            );
            tableAddr = address(new ERC1967Proxy(tableImplementation, initData));
        }

        tables[name]     = tableAddr;
        tableTypes[name] = tableType;
        _tableNames.push(name);

        emit TableCreated(name, tableAddr, owner(), tableType);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getTable(string calldata name) external view returns (address) {
        return tables[name];
    }

    function getTableType(string calldata name) external view returns (TableType) {
        return tableTypes[name];
    }

    function listTables() external view returns (string[] memory) {
        return _tableNames;
    }

    function tableCount() external view returns (uint256) {
        return _tableNames.length;
    }

    // ─────────────────────────────────────────────────────────────
    //  Drop table
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Remove a table from the registry.
     *         Records inside the table are NOT deleted — they remain on-chain.
     *         Use schemaManager.dropTable() from the SDK beforehand to
     *         purge records if you need storage refunds.
     * @param name  Table name to drop.
     */
    function dropTable(string calldata name) external onlyOwner {
        require(tables[name] != address(0), "Web3QLDatabase: table not found");

        delete tables[name];
        delete tableTypes[name];

        // Remove from _tableNames (swap-and-pop)
        uint256 len = _tableNames.length;
        for (uint256 i = 0; i < len; ) {
            if (keccak256(bytes(_tableNames[i])) == keccak256(bytes(name))) {
                _tableNames[i] = _tableNames[len - 1];
                _tableNames.pop();
                break;
            }
            unchecked { ++i; }
        }

        emit TableDropped(name);
    }

    /**
     * @notice Update the shared private-table implementation (owner only).
     *         Existing proxies are NOT upgraded automatically.
     */
    function setTableImplementation(address newImpl) external onlyOwner {
        require(newImpl != address(0), "Web3QLDatabase: zero address");
        tableImplementation = newImpl;
    }

    /**
     * @notice Update the shared public-table implementation (owner only).
     *         Existing proxies are NOT upgraded automatically.
     */
    function setPublicTableImplementation(address newImpl) external onlyOwner {
        require(newImpl != address(0), "Web3QLDatabase: zero address");
        publicTableImplementation = newImpl;
    }
}
