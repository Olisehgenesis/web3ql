'use client';

import { useState, useEffect }                                    from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useChainId, useSwitchChain } from 'wagmi';
import { FACTORY_ADDRESS, FACTORY_ABI, DATABASE_ABI, CHAIN_ID } from '@/lib/contracts';

interface Props {
  onSelect: (addr: string, name: string) => void;
  selected: string | null;
}

export default function DatabaseList({ onSelect, selected }: Props) {
  const { address, isConnected } = useAccount();
  const chainId                  = useChainId();
  const { switchChain }          = useSwitchChain();
  const [newName, setNewName]    = useState('');
  const [creating, setCreating]  = useState(false);

  const onCorrectChain = chainId === CHAIN_ID;

  const { data: databases, refetch } = useReadContract({
    address:      FACTORY_ADDRESS,
    abi:          FACTORY_ABI,
    functionName: 'getUserDatabases',
    args:         [address!],
    query:        { enabled: !!address && onCorrectChain },
  });

  const { writeContract, data: createHash, isPending } = useWriteContract();
  const { isSuccess: createDone } = useWaitForTransactionReceipt({
    hash: createHash,
  });

  useEffect(() => {
    if (createDone && creating) {
      setCreating(false);
      setNewName('');
      refetch();
    }
  }, [createDone]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    writeContract({
      address:      FACTORY_ADDRESS,
      abi:          FACTORY_ABI,
      functionName: 'createDatabase',
      args:         [newName.trim()],
    });
  }

  if (!isConnected) {
    return (
      <div className="text-zinc-500 text-sm text-center py-12">
        Connect your wallet to see your databases.
      </div>
    );
  }

  if (!onCorrectChain) {
    return (
      <div className="flex flex-col gap-3 py-6 text-center">
        <p className="text-amber-400 text-xs font-medium">Wrong network</p>
        <p className="text-zinc-500 text-xs">Switch to Celo Sepolia (chainId 11142220)</p>
        <button
          onClick={() => switchChain({ chainId: CHAIN_ID })}
          className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded-lg transition-colors"
        >
          Switch Network
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Databases
      </h2>

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="new-database"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={isPending || !newName.trim()}
          className="text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors"
        >
          {isPending ? '…' : '+ New'}
        </button>
      </form>

      {/* List */}
      <div className="flex flex-col gap-1">
        {!databases || databases.length === 0 ? (
          <p className="text-zinc-600 text-sm py-4 text-center">No databases yet.</p>
        ) : (
          databases.map((addr) => (
            <DatabaseRow
              key={addr}
              addr={addr}
              selected={selected === addr}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DatabaseRow({
  addr,
  selected,
  onSelect,
}: {
  addr: string;
  selected: boolean;
  onSelect: (addr: string, name: string) => void;
}) {
  const { data: name } = useReadContract({
    address:      addr as `0x${string}`,
    abi:          DATABASE_ABI,
    functionName: 'databaseName',
  });
  const { data: count } = useReadContract({
    address:      addr as `0x${string}`,
    abi:          DATABASE_ABI,
    functionName: 'tableCount',
  });

  const label = (name as string) || addr.slice(0, 8) + '…';

  return (
    <button
      onClick={() => onSelect(addr, label)}
      className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors text-sm ${
        selected
          ? 'bg-emerald-900/40 border border-emerald-700 text-emerald-300'
          : 'bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600 text-zinc-300'
      }`}
    >
      <span className="font-medium truncate">{label}</span>
      <span className="text-xs text-zinc-500 shrink-0 ml-2">
        {count?.toString() ?? '?'} tables
      </span>
    </button>
  );
}
