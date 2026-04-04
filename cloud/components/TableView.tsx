'use client';

import { useState }                                                        from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { TABLE_ABI, recordKey, roleLabel }                                 from '@/lib/contracts';
import { toHex }                                                           from 'viem';

interface Props {
  tableAddr: string;
  tableName: string;
}

export default function TableView({ tableAddr, tableName }: Props) {
  const { address } = useAccount();
  const addr = tableAddr as `0x${string}`;

  const { data: total }   = useReadContract({ address: addr, abi: TABLE_ABI, functionName: 'totalRecords' });
  const { data: active }  = useReadContract({ address: addr, abi: TABLE_ABI, functionName: 'activeRecords' });
  const { data: schema }  = useReadContract({ address: addr, abi: TABLE_ABI, functionName: 'schemaBytes' });
  const { data: myCount } = useReadContract({
    address: addr, abi: TABLE_ABI, functionName: 'ownerRecordCount',
    args: [address!], query: { enabled: !!address },
  });
  const { data: myKeys, refetch: refetchKeys } = useReadContract({
    address: addr, abi: TABLE_ABI, functionName: 'getOwnerRecords',
    args: [address!, BigInt(0), BigInt(25)], query: { enabled: !!address },
  });

  const schemaText = schema
    ? new TextDecoder().decode(Buffer.from((schema as string).slice(2), 'hex'))
    : '';

  return (
    <div className="flex flex-col gap-6">
      {/* Header stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Records" value={total?.toString() ?? '…'} />
        <StatCard label="Active Records" value={active?.toString() ?? '…'} />
        <StatCard label="My Records" value={myCount?.toString() ?? '…'} />
      </div>

      {/* Schema */}
      {schemaText && (
        <div className="bg-zinc-900 border border-zinc-700/50 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-1 uppercase tracking-widest">Schema</p>
          <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap break-all">
            {schemaText}
          </pre>
        </div>
      )}

      {/* Write record */}
      <WriteRecord tableAddr={addr} tableName={tableName} onDone={() => refetchKeys()} />

      {/* My records */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
          My Records
        </h3>
        {!myKeys || (myKeys as `0x${string}`[]).length === 0 ? (
          <p className="text-zinc-600 text-sm text-center py-4">
            No records yet — write one above.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {(myKeys as `0x${string}`[]).map((key) => (
              <RecordRow key={key} tableAddr={addr} recordKey={key} onDone={() => refetchKeys()} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-700/50 rounded-lg px-4 py-3">
      <p className="text-xs text-zinc-500 uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-semibold text-zinc-100 mt-0.5">{value}</p>
    </div>
  );
}

// ─── Write record ─────────────────────────────────────────────────────────────

function WriteRecord({
  tableAddr,
  tableName,
  onDone,
}: {
  tableAddr: `0x${string}`;
  tableName: string;
  onDone: () => void;
}) {
  const [pk,   setPk]   = useState('');
  const [data, setData] = useState('');
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash });

  if (isSuccess) { onDone(); }

  function handleWrite(e: React.FormEvent) {
    e.preventDefault();
    if (!pk.trim() || !data.trim()) return;
    const key       = recordKey(tableName, pk.trim());
    // Plaintext stored directly as "ciphertext" — replace with real encryption in production
    const cipher    = toHex(new TextEncoder().encode(data.trim()));
    const encKey    = toHex(new TextEncoder().encode('__plaintext_demo__'));
    writeContract({
      address: tableAddr, abi: TABLE_ABI, functionName: 'write',
      args: [key, cipher, encKey],
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700/50 rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
        Write Record
      </h3>
      <form onSubmit={handleWrite} className="flex flex-col gap-2">
        <input
          value={pk}
          onChange={e => setPk(e.target.value)}
          placeholder="Primary key (e.g. user-1)"
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
        />
        <textarea
          value={data}
          onChange={e => setData(e.target.value)}
          rows={3}
          placeholder='{"name":"Alice","balance":100}'
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-mono resize-none"
        />
        <button
          type="submit"
          disabled={isPending || !pk.trim() || !data.trim()}
          className="text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors"
        >
          {isPending ? 'Writing…' : 'Write to chain'}
        </button>
      </form>
    </div>
  );
}

// ─── Individual record row ────────────────────────────────────────────────────

function RecordRow({
  tableAddr,
  recordKey: key,
  onDone,
}: {
  tableAddr: `0x${string}`;
  recordKey: `0x${string}`;
  onDone: () => void;
}) {
  const [expanded, setExpanded]       = useState(false);
  const [showCollabs, setShowCollabs] = useState(false);

  const { data: rec } = useReadContract({
    address: tableAddr, abi: TABLE_ABI, functionName: 'read', args: [key],
  });
  const { data: collabs } = useReadContract({
    address: tableAddr, abi: TABLE_ABI, functionName: 'getCollaborators', args: [key],
    query: { enabled: showCollabs },
  });
  const { writeContract, data: delHash, isPending: delPending } = useWriteContract();
  const { isSuccess: delDone } = useWaitForTransactionReceipt({ hash: delHash });
  if (delDone) onDone();

  if (!rec) return null;
  const recTuple = rec as unknown as [`0x${string}`, boolean, bigint, bigint, `0x${string}`];
  const [cipher, deleted, version, updatedAt, owner] = recTuple;
  if (deleted) return null;

  let plaintext = '';
  try {
    plaintext = new TextDecoder().decode(
      Buffer.from((cipher as unknown as string).slice(2), 'hex')
    );
  } catch { plaintext = '[binary]'; }

  const ts = new Date(Number(updatedAt) * 1000).toLocaleString();

  return (
    <div className="bg-zinc-900 border border-zinc-700/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <span className="font-mono text-xs text-zinc-400">{key.slice(0, 16)}…</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">v{version.toString()} · {ts}</span>
          <span className="text-zinc-500">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3 border-t border-zinc-800">
          <div className="mt-3">
            <p className="text-xs text-zinc-500 mb-1">Ciphertext (plaintext in demo)</p>
            <pre className="text-xs font-mono text-emerald-400 bg-zinc-800 rounded p-2 whitespace-pre-wrap break-all">
              {plaintext}
            </pre>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-500">Owner: <span className="font-mono text-zinc-400">{(owner as string).slice(0, 10)}…</span></span>

            <button
              onClick={() => setShowCollabs(!showCollabs)}
              className="text-xs text-sky-400 hover:text-sky-300 underline"
            >
              {showCollabs ? 'Hide' : 'Show'} collaborators
            </button>

            <button
              onClick={() => writeContract({
                address: tableAddr, abi: TABLE_ABI, functionName: 'deleteRecord', args: [key],
              })}
              disabled={delPending}
              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40 ml-auto border border-red-700/40 hover:border-red-600 rounded px-2 py-1 transition-colors"
            >
              {delPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>

          {showCollabs && collabs && (
            <CollaboratorList
              tableAddr={tableAddr}
              recordKey={key}
              collabs={collabs as string[]}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Collaborator list ────────────────────────────────────────────────────────

function CollaboratorList({
  tableAddr,
  recordKey: key,
  collabs,
}: {
  tableAddr: `0x${string}`;
  recordKey: `0x${string}`;
  collabs: string[];
}) {
  return (
    <div className="bg-zinc-800 rounded-lg p-3">
      <p className="text-xs text-zinc-500 mb-2 uppercase tracking-widest">
        Collaborators ({collabs.length})
      </p>
      {collabs.length === 0 ? (
        <p className="text-zinc-600 text-xs">None.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {collabs.map((addr) => (
            <CollaboratorRow
              key={addr}
              tableAddr={tableAddr}
              recordKey={key}
              user={addr}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CollaboratorRow({
  tableAddr,
  recordKey: key,
  user,
}: {
  tableAddr: `0x${string}`;
  recordKey: `0x${string}`;
  user: string;
}) {
  const { address: me } = useAccount();
  const { data: role }  = useReadContract({
    address: tableAddr, abi: TABLE_ABI, functionName: 'getRole', args: [key, user as `0x${string}`],
  });
  const { writeContract, isPending } = useWriteContract();
  const isMe = me?.toLowerCase() === user.toLowerCase();

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="font-mono text-zinc-400">{user.slice(0, 10)}… {isMe && '(you)'}</span>
      <div className="flex items-center gap-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
          role === 3 ? 'bg-emerald-900 text-emerald-300' :
          role === 2 ? 'bg-sky-900 text-sky-300' :
          'bg-zinc-700 text-zinc-400'
        }`}>
          {roleLabel(Number(role ?? 0))}
        </span>
        {!isMe && (
          <button
            disabled={isPending}
            onClick={() => writeContract({
              address: tableAddr, abi: TABLE_ABI, functionName: 'revokeAccess',
              args: [key, user as `0x${string}`],
            })}
            className="text-red-400 hover:text-red-300 disabled:opacity-40"
          >
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}
