# Web3QL — Tests

Integration tests for the Web3QL connector relay.

## Files

| File | What it tests |
|---|---|
| `keyManager.test.js` | Key derivation, encryption round-trip, X25519 stability |
| `relay.test.js` | Relay API — register wallet, submit intent, read back |

## Running

```bash
node --test tests/keyManager.test.js
node --test tests/relay.test.js
```

## Environment for relay tests

```env
RELAY_URL=http://localhost:3004
RELAY_API_KEY=your_secret_key
PRIVATE_KEY=0x...    # test wallet with testnet CELO
```

Get Celo Sepolia testnet CELO: https://faucet.celo.org/alfajores
