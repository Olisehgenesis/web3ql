'use client';

import { useState, useEffect }                                                          from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt }             from 'wagmi';
import { DATABASE_ABI, TABLE_ABI }                                                     from '@/lib/contracts';
import { toast }                                                                       from 'sonner';
import { SchemaBuilder }                                                               from '@/components/tables/SchemaBuilder';
import { schemaToSQL }                                                                 from '@/lib/utils/schema';
import type { SchemaField }                                                            from '@/lib/utils/schema';
import { encodeSchema }                                                                from '@/lib/utils/schema';

interface Props {
  dbAddr: string;
  onSelect: (addr: string, name: string) => void;
  selected: string | null;
}

const DEFAULT_FIELDS: SchemaField[] = [{ name: 'id', type: 'INT', primaryKey: true }];

export default function TableList({ dbAddr, onSelect, selected }: Props) {
  const [newName,  setNewName]  = useState('');
  const [fields,   setFields]   = useState<SchemaField[]>(DEFAULT_FIELDS);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const { data: tables, isLoading, refetch } = useReadContract({
    address:      dbAddr as `0x${string}`,
    abi:          DATABASE_ABI,
    functionName: 'listTables',
  });

  const { writeContract, data: createHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: createDone } = useWaitForTransactionReceipt({ hash: createHash });

  useEffect(() => {
    if (createDone && creating) {
      setCreating(false);
      setNewName('');
      setFields(DEFAULT_FIELDS);
      setShowForm(false);
      toast.success('Table created on-chain');
      refetch();
    }
  }, [createDone]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || fields.length === 0) return;
    const sql = schemaToSQL(newName.trim(), fields);
    setCreating(true);
    writeContract(
      {
        address:      dbAddr as `0x${string}`,
        abi:          DATABASE_ABI,
        functionName: 'createTable',
        args:         [newName.trim(), encodeSchema(sql)],
      },
      {
        onError: (err) => {
          setCreating(false);
          toast.error(err.message?.split('\n')[0] ?? 'Transaction failed');
        },
      }
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Tables
        </h2>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
        >
          {showForm ? 'Cancel' : '+ New Table'}
        </button>
      </div>

      {/* Create form — toggled */}
      {showForm && (
        <form onSubmit={handleCreate} className="flex flex-col gap-3 bg-zinc-800/40 border border-zinc-700/50 rounded-lg p-3">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="table_name"
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-500"
          />
          <SchemaBuilder fields={fields} onChange={setFields} disabled={isPending || isConfirming} />
          <button
            type="submit"
            disabled={isPending || isConfirming || !newName.trim() || fields.length === 0}
            className="text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {isPending ? 'Confirm in wallet…' : isConfirming ? 'Creating on-chain…' : 'Create Table'}
          </button>
        </form>
      )}

      {/* List */}
      <div className="flex flex-col gap-1">
        {isLoading ? (
          <>
            {[1, 2].map((i) => (
              <div key={i} className="h-10 rounded-lg bg-zinc-800/60 animate-pulse" />
            ))}
          </>
        ) : !tables || tables.length === 0 ? (
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
