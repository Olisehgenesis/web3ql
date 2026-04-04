'use client';

import { wagmiAdapter, projectId, networks, celoSepolia } from '@/config';
import { QueryClient, QueryClientProvider }               from '@tanstack/react-query';
import { createAppKit }                                   from '@reown/appkit/react';
import { type ReactNode }                                 from 'react';
import { cookieToInitialState, WagmiProvider, type Config } from 'wagmi';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

const metadata = {
  name:        'Web3QL Cloud',
  description: '100% on-chain SQL database — powered by Celo',
  url:         typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
  icons:       ['https://avatars.githubusercontent.com/u/179229932'],
};

createAppKit({
  adapters:       [wagmiAdapter],
  projectId,
  networks,
  defaultNetwork: celoSepolia,
  metadata,
  features: { analytics: false },
});

export default function Providers({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const initialState = cookieToInitialState(
    wagmiAdapter.wagmiConfig as Config,
    cookies
  );

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig as Config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
