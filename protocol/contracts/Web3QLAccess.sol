// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  Web3QLAccess
 * @notice Shared role-based access control for the Web3QL protocol.
 *         Roles are scoped to a bytes32 resource key (table record key,
 *         table address hash, etc.) and an address.
 *
 *         Role hierarchy:  NONE < VIEWER < EDITOR < OWNER
 *         Higher roles implicitly satisfy lower-role checks.
 */
abstract contract Web3QLAccess {

    // ─────────────────────────────────────────────────────────────
    //  Types
    // ─────────────────────────────────────────────────────────────

    enum Role { NONE, VIEWER, EDITOR, OWNER }

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    /// permissions[resourceKey][user] = role
    mapping(bytes32 => mapping(address => Role)) private _permissions;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event RoleGranted(bytes32 indexed resource, address indexed user, Role role, address indexed granter);
    event RoleRevoked(bytes32 indexed resource, address indexed user, address indexed revoker);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyResourceOwner(bytes32 resource) {
        require(
            _permissions[resource][msg.sender] == Role.OWNER,
            "Web3QLAccess: caller is not resource owner"
        );
        _;
    }

    modifier onlyEditor(bytes32 resource) {
        require(
            _permissions[resource][msg.sender] >= Role.EDITOR,
            "Web3QLAccess: caller lacks EDITOR role"
        );
        _;
    }

    modifier onlyReader(bytes32 resource) {
        require(
            _permissions[resource][msg.sender] >= Role.VIEWER,
            "Web3QLAccess: caller lacks VIEWER role"
        );
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Internal helpers
    // ─────────────────────────────────────────────────────────────

    function _setOwner(bytes32 resource, address user) internal {
        _permissions[resource][user] = Role.OWNER;
        emit RoleGranted(resource, user, Role.OWNER, msg.sender);
    }

    function _grantRole(bytes32 resource, address user, Role role) internal {
        require(user != address(0), "Web3QLAccess: zero address");
        require(role != Role.NONE,  "Web3QLAccess: use revokeRole to remove");
        require(
            _permissions[resource][msg.sender] == Role.OWNER,
            "Web3QLAccess: caller is not resource owner"
        );
        // Prevent privilege escalation: granter cannot grant a role >= their own
        require(
            role < Role.OWNER,
            "Web3QLAccess: cannot grant OWNER role via grantRole"
        );
        _permissions[resource][user] = role;
        emit RoleGranted(resource, user, role, msg.sender);
    }

    function _revokeRole(bytes32 resource, address user) internal {
        require(
            _permissions[resource][msg.sender] == Role.OWNER,
            "Web3QLAccess: caller is not resource owner"
        );
        require(
            _permissions[resource][user] != Role.OWNER,
            "Web3QLAccess: cannot revoke owner"
        );
        delete _permissions[resource][user];
        emit RoleRevoked(resource, user, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────
    //  Public views
    // ─────────────────────────────────────────────────────────────

    function hasRole(bytes32 resource, address user, Role role) public view returns (bool) {
        return _permissions[resource][user] >= role;
    }

    function getRole(bytes32 resource, address user) public view returns (Role) {
        return _permissions[resource][user];
    }

    // ─────────────────────────────────────────────────────────────
    //  Public mutators (callable by contracts that inherit this)
    // ─────────────────────────────────────────────────────────────

    function grantRole(bytes32 resource, address user, Role role) external {
        _grantRole(resource, user, role);
    }

    function revokeRole(bytes32 resource, address user) external {
        _revokeRole(resource, user);
    }
}
