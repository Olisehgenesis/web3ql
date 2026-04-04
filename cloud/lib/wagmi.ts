/**
 * Chain definition for Celo Sepolia (chainId 11142220).
 * This is the long-term Celo testnet where Web3QL contracts are deployed.
 * Note: Celo Alfajores (44787) is a DIFFERENT testnet.
 */
import { http, createConfig } from 'wagmi';
import { defineChain }        from 'viem';

export const celoSepolia = defineChain({
  id:          11142220,
  name:        'Celo Sepolia',
  nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://forno.celo-sepolia.celo-testnet.org'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://celo-sepolia.blockscout.com' },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains:     [celoSepolia],
  transports: { [celoSepolia.id]: http() },
  ssr:        true,
});
