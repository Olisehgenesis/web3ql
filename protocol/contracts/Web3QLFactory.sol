// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./Web3QLDatabase.sol";
import "./Web3QLTable.sol";

/**
 * @title  Web3QLFactory
 * @notice Singleton factory deployed once on Celo.
 *
 *         Any user calls createDatabase() to deploy a personal
 *         Web3QLDatabase contract (as a UUPS proxy).  The factory
 *         tracks all databases per owner.
 *
 *         Three shared implementation contracts are managed here:
 *           • databaseImplementation      — Web3QLDatabase logic
 *           • tableImplementation         — Web3QLTable (private) logic
 *           • publicTableImplementation   — Web3QLPublicTable logic
 *
 * @dev    The factory itself is UUPS-upgradeable so the Web3QL team
 *         can push improvements without redeploying user databases.
 */
contract Web3QLFactory is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    /// Shared implementation contracts (upgraded by factory owner).
    address public databaseImplementation;
    address public tableImplementation;
    address public publicTableImplementation;

    /// user → list of database proxy addresses
    mapping(address => address[]) private _userDatabases;

    /// All deployed databases (for admin enumeration)
    address[] private _allDatabases;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event DatabaseCreated(
        address indexed owner,
        address indexed db,
        uint256 indexed index
    );
    event ImplementationsUpdated(
        address dbImpl,
        address tableImpl,
        address publicTableImpl
    );

    // ─────────────────────────────────────────────────────────────
    //  Initializer
    // ─────────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    /**
     * @param _owner               Protocol admin (multisig recommended).
     * @param _databaseImpl        Deployed Web3QLDatabase logic address.
     * @param _tableImpl           Deployed Web3QLTable (private) logic address.
     * @param _publicTableImpl     Deployed Web3QLPublicTable logic address.
     */
    function initialize(
        address _owner,
        address _databaseImpl,
        address _tableImpl,
        address _publicTableImpl
    ) external initializer {
        __Ownable_init(_owner);
        require(_databaseImpl    != address(0), "Web3QLFactory: zero databaseImpl");
        require(_tableImpl       != address(0), "Web3QLFactory: zero tableImpl");
        require(_publicTableImpl != address(0), "Web3QLFactory: zero publicTableImpl");
        databaseImplementation    = _databaseImpl;
        tableImplementation       = _tableImpl;
        publicTableImplementation = _publicTableImpl;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─────────────────────────────────────────────────────────────
    //  Core: create a database
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Deploy a new Web3QLDatabase owned by msg.sender.
     * @return db  Address of the new database proxy.
     *
     * @dev  The database proxy is initialised with:
     *         - owner                   = msg.sender
     *         - tableImplementation     = factory.tableImplementation
     *         - publicTableImplementation = factory.publicTableImplementation
     *       so the user controls their own database independently of the
     *       factory after deployment.
     */
    function createDatabase(string calldata name) external returns (address db) {
        bytes memory initData = abi.encodeCall(
            Web3QLDatabase.initialize,
            (msg.sender, tableImplementation, publicTableImplementation, name)
        );

        db = address(new ERC1967Proxy(databaseImplementation, initData));

        _userDatabases[msg.sender].push(db);
        _allDatabases.push(db);

        emit DatabaseCreated(msg.sender, db, _allDatabases.length - 1);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getUserDatabases(address user) external view returns (address[] memory) {
        return _userDatabases[user];
    }

    function databaseCount() external view returns (uint256) {
        return _allDatabases.length;
    }

    function getDatabaseAt(uint256 index) external view returns (address) {
        return _allDatabases[index];
    }

    // ─────────────────────────────────────────────────────────────
    //  Remove a database entry from the user’s list
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Remove a database proxy from the caller’s list.
     *         The proxy contract is NOT destroyed — it remains on-chain.
     *         This only removes the factory’s reference so it stops
     *         appearing in getUserDatabases().
     * @param db  Address of the database proxy to remove.
     */
    function removeDatabase(address db) external {
        address[] storage list = _userDatabases[msg.sender];
        uint256 len = list.length;
        bool found = false;
        for (uint256 i = 0; i < len; ) {
            if (list[i] == db) {
                list[i] = list[len - 1];
                list.pop();
                found = true;
                break;
            }
            unchecked { ++i; }
        }
        require(found, "Web3QLFactory: database not owned by caller");
        emit DatabaseRemoved(msg.sender, db);
    }

    event DatabaseRemoved(address indexed owner, address indexed db);

    // ─────────────────────────────────────────────────────────────
    //  Admin: upgrade shared implementations
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Update the reference implementation contracts.
     *         Does NOT auto-upgrade existing proxies — each database /
     *         table proxy must be individually upgraded via upgradeToAndCall.
     */
    function setImplementations(
        address newDatabaseImpl,
        address newTableImpl,
        address newPublicTableImpl
    ) external onlyOwner {
        require(newDatabaseImpl    != address(0), "Web3QLFactory: zero databaseImpl");
        require(newTableImpl       != address(0), "Web3QLFactory: zero tableImpl");
        require(newPublicTableImpl != address(0), "Web3QLFactory: zero publicTableImpl");
        databaseImplementation    = newDatabaseImpl;
        tableImplementation       = newTableImpl;
        publicTableImplementation = newPublicTableImpl;
        emit ImplementationsUpdated(newDatabaseImpl, newTableImpl, newPublicTableImpl);
    }
}
