// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  PublicKeyRegistry
 * @notice Stores one X25519 encryption public key per Ethereum address.
 *
 * Why is this needed?
 * ─────────────────────────────────────────────────────────────
 *  When Alice wants to share a record with Bob, she needs Bob's
 *  X25519 public key to encrypt the symmetric key for him.
 *  Bob registers his public key here once (~40k gas), and Alice
 *  looks it up before calling grantAccess().
 *
 * Key derivation (SDK side):
 *  The X25519 private key = SHA-256(Ethereum private key)
 *  The X25519 public key  = scalar_mult(privKey, Curve25519.G)
 *  This is done entirely off-chain in @web3ql/sdk's crypto module.
 *
 * Security:
 *  • Registering here reveals only the X25519 PUBLIC key.
 *  • The Ethereum private key and X25519 private key are never
 *    transmitted or stored anywhere.
 *  • Users can rotate their key at any time by calling register()
 *    again — old encrypted records won't be accessible with the
 *    new key (same as real-world key rotation).
 *
 * @dev    Intentionally NOT upgradeable — immutable registry.
 *         Deploy once on Celo, share the address in the SDK config.
 */
contract PublicKeyRegistry {

    // ─────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────

    /// address → X25519 public key (32 bytes packed into bytes32)
    mapping(address => bytes32) private _keys;

    // ─────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────

    event KeyRegistered(address indexed user, bytes32 publicKey);

    // ─────────────────────────────────────────────────────────
    //  Write
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Register (or rotate) your X25519 encryption public key.
     * @param pubKey  32-byte X25519 public key from @web3ql/sdk's deriveKeypair().
     *
     * One-time cost ~40k gas on Celo (~$0.001).
     * Can be re-called to rotate the key — existing encrypted records
     * will need to be re-shared by their owners after rotation.
     */
    function register(bytes32 pubKey) external {
        require(pubKey != bytes32(0), "PublicKeyRegistry: pubKey must not be zero");
        _keys[msg.sender] = pubKey;
        emit KeyRegistered(msg.sender, pubKey);
    }

    // ─────────────────────────────────────────────────────────
    //  Read
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Return the X25519 public key for a registered address.
     * @dev    Reverts if the address has never registered.
     *         Use hasKey() to check first if you want a graceful fallback.
     */
    function getKey(address user) external view returns (bytes32) {
        require(
            _keys[user] != bytes32(0),
            "PublicKeyRegistry: address has not registered a public key"
        );
        return _keys[user];
    }

    /**
     * @notice Check whether an address has a registered key.
     */
    function hasKey(address user) external view returns (bool) {
        return _keys[user] != bytes32(0);
    }
}
