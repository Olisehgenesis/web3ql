import { cookieStorage, createStorage } from 'wagmi';
import { WagmiAdapter }                 from '@reown/appkit-adapter-wagmi';
import { defineChain }                  from 'viem';

export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID ?? '';

// Celo Sepolia — custom chain (not in @reown/appkit/networks)
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const networks = [celoSepolia] as any;

export const wagmiAdapter = new WagmiAdapter({
  storage:   createStorage({ storage: cookieStorage }),
  ssr:       true,
  projectId,
  networks,
});
