// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./Web3QLTable.sol";

/**
 * @title  Web3QLDatabase
 * @notice Per-user / per-project database contract.
 *         Manages a registry of named Web3QLTable contracts.
 *
 *         Each table is deployed as a UUPS proxy backed by the shared
 *         Web3QLTable implementation, minimising deployment gas.
 *
 * @dev    Deployed by Web3QLFactory.createDatabase() as a UUPS proxy.
 */
contract Web3QLDatabase is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    /// Shared Web3QLTable implementation address (set by Factory on init).
    address public tableImplementation;

    /// Human-readable database name.
    string public databaseName;

    /// name → table proxy address
    mapping(string => address) public tables;

    /// Ordered list of table names for enumeration.
    string[] private _tableNames;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event TableCreated(string indexed name, address tableContract, address indexed owner);

    // ─────────────────────────────────────────────────────────────
    //  Initializer
    // ─────────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _owner,
        address _tableImplementation,
        string calldata _name
    ) external initializer {
        __Ownable_init(_owner);
        tableImplementation = _tableImplementation;
        databaseName = _name;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─────────────────────────────────────────────────────────────
    //  Table management
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice  Deploy a new table for this database.
     * @param   name        Human-readable table name (must be unique in this db).
     * @param   schemaBytes ABI-encoded schema AST for SDK codegen / introspection.
     * @return  tableAddr   Address of the deployed Web3QLTable proxy.
     *
     * @dev  The table proxy is initialized with `owner()` as the table owner
     *       so the database owner controls all lifecycle operations.
     *       Deploys using ERC1967Proxy against the shared implementation.
     */
    function createTable(
        string calldata name,
        bytes  calldata schemaBytes
    ) external onlyOwner returns (address tableAddr) {
        require(bytes(name).length  > 0,           "Web3QLDatabase: empty name");
        require(tables[name] == address(0),        "Web3QLDatabase: table exists");
        require(schemaBytes.length  > 0,           "Web3QLDatabase: empty schema");

        bytes memory initData = abi.encodeCall(
            Web3QLTable.initialize,
            (owner(), name, schemaBytes)
        );

        tableAddr = address(new ERC1967Proxy(tableImplementation, initData));

        tables[name] = tableAddr;
        _tableNames.push(name);

        emit TableCreated(name, tableAddr, owner());
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getTable(string calldata name) external view returns (address) {
        return tables[name];
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
     *         Records inside the table are NOT deleted by this call —
     *         they remain on-chain as unreachable ciphertext.
     *         Use schemaManager.dropTable() from the SDK beforehand to
     *         purge records if you need storage refunds.
     * @param name  Table name to drop.
     */
    function dropTable(string calldata name) external onlyOwner {
        require(tables[name] != address(0), "Web3QLDatabase: table not found");

        delete tables[name];

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

    event TableDropped(string indexed name);

    /**
     * @notice Update the shared table implementation (owner only).
     *         Existing proxies are NOT upgraded automatically — call
     *         upgradeToAndCall on each table proxy individually.
     */
    function setTableImplementation(address newImpl) external onlyOwner {
        require(newImpl != address(0), "Web3QLDatabase: zero address");
        tableImplementation = newImpl;
    }
}
