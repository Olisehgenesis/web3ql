'use client';

import { useAppKit, useAppKitAccount } from '@reown/appkit/react';

export default function ConnectButton() {
  const { open }                    = useAppKit();
  const { address, isConnected }    = useAppKitAccount();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-3 py-1.5 rounded-sm">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button
          onClick={() => open({ view: 'Account' })}
          aria-label="Manage wallet account"
          className="text-xs text-zinc-400 hover:text-emerald-400 transition-colors px-3 py-1.5 rounded-sm border border-zinc-700 hover:border-emerald-700"
        >
          Account
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => open()}
      aria-label="Connect your wallet"
      className="text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-sm transition-colors"
    >
      Connect Wallet
    </button>
  );
}
