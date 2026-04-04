'use client';

import { useState, useEffect }                                                          from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt }             from 'wagmi';
import { DATABASE_ABI, TABLE_ABI }                                                     from '@/lib/contracts';
import { toHex }                                                                       from 'viem';

interface Props {
  dbAddr: string;
  onSelect: (addr: string, name: string) => void;
  selected: string | null;
}

export default function TableList({ dbAddr, onSelect, selected }: Props) {
  const [newName,   setNewName]   = useState('');
  const [newSchema, setNewSchema] = useState('');
  const [creating,  setCreating]  = useState(false);

  const { data: tables, refetch } = useReadContract({
    address:      dbAddr as `0x${string}`,
    abi:          DATABASE_ABI,
    functionName: 'listTables',
  });

  const { writeContract, data: createHash, isPending } = useWriteContract();
  const { isSuccess: createDone } = useWaitForTransactionReceipt({ hash: createHash });

  useEffect(() => {
    if (createDone && creating) {
      setCreating(false);
      setNewName('');
      setNewSchema('');
      refetch();
    }
  }, [createDone]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newSchema.trim()) return;
    setCreating(true);
    writeContract({
      address:      dbAddr as `0x${string}`,
      abi:          DATABASE_ABI,
      functionName: 'createTable',
      args:         [newName.trim(), toHex(new TextEncoder().encode(newSchema.trim()))],
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Tables
      </h2>

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex flex-col gap-2">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="table_name"
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
        />
        <input
          value={newSchema}
          onChange={e => setNewSchema(e.target.value)}
          placeholder="CREATE TABLE users (id INT PRIMARY KEY, name TEXT)"
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-mono"
        />
        <button
          type="submit"
          disabled={isPending || !newName.trim() || !newSchema.trim()}
          className="text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors"
        >
          {isPending ? 'Creating…' : '+ Create Table'}
        </button>
      </form>

      {/* List */}
      <div className="flex flex-col gap-1">
        {!tables || tables.length === 0 ? (
          <p className="text-zinc-600 text-sm py-4 text-center">No tables yet.</p>
        ) : (
          (tables as string[]).map((name) => (
            <TableRow
              key={name}
              dbAddr={dbAddr}
              name={name}
              selected={selected === name}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TableRow({
  dbAddr,
  name,
  selected,
  onSelect,
}: {
  dbAddr: string;
  name: string;
  selected: boolean;
  onSelect: (addr: string, name: string) => void;
}) {
  const { data: tableAddr } = useReadContract({
    address:      dbAddr as `0x${string}`,
    abi:          DATABASE_ABI,
    functionName: 'getTable',
    args:         [name],
  });
  const { data: active } = useReadContract({
    address:      tableAddr as `0x${string}` | undefined,
    abi:          TABLE_ABI,
    functionName: 'activeRecords',
    query:        { enabled: !!tableAddr },
  });

  return (
    <button
      onClick={() => tableAddr && onSelect(tableAddr as string, name)}
      className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors text-sm ${
        selected
          ? 'bg-sky-900/40 border border-sky-700 text-sky-300'
          : 'bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600 text-zinc-300'
      }`}
    >
      <span className="font-mono">{name}</span>
      <span className="text-xs text-zinc-500 shrink-0 ml-2">
        {active?.toString() ?? '?'} rows
      </span>
    </button>
  );
}
