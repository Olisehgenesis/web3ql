'use client';

import { useState }                                                        from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { TABLE_ABI, recordKey, roleLabel, MULTICALL3_ADDRESS, MULTICALL3_ABI } from '@/lib/contracts';
import { toHex, isAddress, encodeFunctionData }                            from 'viem';
import { toast }                                                           from 'sonner';
import { AlertTriangle, ChevronLeft, ChevronRight, Pencil, X, Layers }    from 'lucide-react';

interface Props {
  tableAddr: string;
  tableName: string;
}

const PAGE_SIZE = 25;

export default function TableView({ tableAddr, tableName }: Props) {
  const { address } = useAccount();
  const addr = tableAddr as `0x${string}`;
  const [page, setPage] = useState(0);
  const [writeTab, setWriteTab] = useState<'single' | 'batch'>('single');
  const offset = BigInt(page * PAGE_SIZE);

  const { data: total }   = useReadContract({ address: addr, abi: TABLE_ABI, functionName: 'totalRecords' });
  const { data: active }  = useReadContract({ address: addr, abi: TABLE_ABI, functionName: 'activeRecords' });
  const { data: schema }  = useReadContract({ address: addr, abi: TABLE_ABI, functionName: 'schemaBytes' });
  const { data: myCount } = useReadContract({
    address: addr, abi: TABLE_ABI, functionName: 'ownerRecordCount',
    args: [address!], query: { enabled: !!address },
  });
  const { data: myKeys, refetch: refetchKeys } = useReadContract({
    address: addr, abi: TABLE_ABI, functionName: 'getActiveOwnerRecords',
    args: [address!, offset, BigInt(PAGE_SIZE)], query: { enabled: !!address },
  });

  const schemaText = schema
    ? new TextDecoder().decode(Buffer.from((schema as string).slice(2), 'hex'))
    : '';

  const totalPages = myCount ? Math.ceil(Number(myCount) / PAGE_SIZE) : 1;

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
          <pre className="text-xs font-mono text-violet-400 whitespace-pre-wrap break-all">
            {schemaText}
          </pre>
        </div>
      )}

      {/* Write / Batch tabs */}
      <div className="bg-zinc-900 border border-zinc-700/50 rounded-lg overflow-hidden">
        <div className="flex border-b border-zinc-800">
          <button
            onClick={() => setWriteTab('single')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
              writeTab === 'single'
                ? 'text-violet-300 border-b-2 border-violet-500 -mb-px'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Write Record
          </button>
          <button
            onClick={() => setWriteTab('batch')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
              writeTab === 'batch'
                ? 'text-violet-300 border-b-2 border-violet-500 -mb-px'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Batch Import
            <span className="bg-violet-900/60 text-violet-300 text-[10px] px-1.5 py-0.5 rounded-full">gas-efficient</span>
          </button>
        </div>
        {writeTab === 'single'
          ? <WriteRecord tableAddr={addr} tableName={tableName} onDone={() => { setPage(0); refetchKeys(); }} />
          : <BatchImport tableAddr={addr} tableName={tableName} onDone={() => { setPage(0); refetchKeys(); }} />
        }
      </div>

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
          <>
            <div className="flex flex-col gap-2">
              {(myKeys as `0x${string}`[]).map((key) => (
                <RecordRow key={key} tableAddr={addr} recordKey={key} onDone={() => refetchKeys()} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-800">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-30 transition-colors"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous
                </button>
                <span className="text-xs text-zinc-500">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-30 transition-colors"
                  aria-label="Next page"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </>
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
  const [acknowledged, setAcknowledged] = useState(false);
  const [done, setDone] = useState(false);
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  if (isSuccess && !done) {
    setDone(true);
    setPk('');
    setData('');
    toast.success('Record written to chain');
    onDone();
  }
  if (!isSuccess && done) setDone(false);

  function handleWrite(e: React.FormEvent) {
    e.preventDefault();
    if (!pk.trim() || !data.trim()) return;
    const key    = recordKey(tableName, pk.trim());
    const cipher = toHex(new TextEncoder().encode(data.trim()));
    const encKey = toHex(new TextEncoder().encode('__plaintext_demo__'));
    writeContract(
      { address: tableAddr, abi: TABLE_ABI, functionName: 'write', args: [key, cipher, encKey] },
      { onError: (err) => toast.error(err.message?.split('\n')[0] ?? 'Transaction failed') }
    );
  }

  return (
    <div className="p-4 flex flex-col gap-3">

      {/* Demo-mode plaintext warning */}
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2">
        <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-amber-300 font-medium">Demo mode — data is stored unencrypted</p>
          <p className="text-xs text-amber-400/80 mt-0.5">
            Do not write sensitive data. Real encryption via the SDK will be enabled in production.
          </p>
          <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="h-3.5 w-3.5 accent-amber-500"
            />
            <span className="text-[11px] text-amber-400">I understand this data is public</span>
          </label>
        </div>
      </div>

      <form onSubmit={handleWrite} className="flex flex-col gap-2">
        <input
          value={pk}
          onChange={e => setPk(e.target.value)}
          placeholder="Primary key (e.g. user-1)"
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-500"
        />
        <textarea
          value={data}
          onChange={e => setData(e.target.value)}
          rows={3}
          placeholder='{"name":"Alice","balance":100}'
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-500 font-mono resize-none"
        />
        <button
          type="submit"
          disabled={isPending || isConfirming || !pk.trim() || !data.trim() || !acknowledged}
          className="text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors"
        >
          {isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming on-chain…' : 'Write to chain'}
        </button>
      </form>
    </div>
  );
}

// ─── Batch import (Multicall3, auto-chunked) ─────────────────────────────────

const CHUNK_SIZE = 50; // safe ceiling: ~50 writes × ~250k gas = ~12.5M gas (well under Celo's 32M limit)

function BatchImport({
  tableAddr,
  tableName,
  onDone,
}: {
  tableAddr: `0x${string}`;
  tableName: string;
  onDone: () => void;
}) {
  const [raw, setRaw]           = useState('');
  const [format, setFormat]     = useState<'csv' | 'json'>('csv');
  const [acknowledged, setAcknowledged] = useState(false);
  const [preview, setPreview]   = useState<{ pk: string; data: string }[]>([]);
  // chunked submission state
  const [chunks, setChunks]     = useState<{ target: `0x${string}`; allowFailure: boolean; callData: `0x${string}` }[][]>([]);
  const [chunkIdx, setChunkIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]         = useState(false);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess }   = useWaitForTransactionReceipt({ hash });

  // When a chunk tx confirms, either advance to next chunk or finish
  if (isSuccess && submitting && !done) {
    if (chunkIdx + 1 < chunks.length) {
      // Submit next chunk
      const nextIdx = chunkIdx + 1;
      setChunkIdx(nextIdx);
      writeContract(
        { address: MULTICALL3_ADDRESS, abi: MULTICALL3_ABI, functionName: 'aggregate3', args: [chunks[nextIdx]] },
        { onError: (err) => { setSubmitting(false); toast.error(err.message?.split('\n')[0] ?? 'Batch failed'); } }
      );
    } else {
      setDone(true);
      setSubmitting(false);
      setRaw('');
      setPreview([]);
      setChunks([]);
      setChunkIdx(0);
      toast.success(
        chunks.length === 1
          ? `${preview.length} records written in 1 transaction`
          : `${preview.length} records written in ${chunks.length} transactions`
      );
      onDone();
    }
  }
  if (!isSuccess && done) setDone(false);

  function parseRows(text: string): { pk: string; data: string }[] {
    if (format === 'json') {
      try {
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) throw new Error('Expected JSON array');
        return arr.map((r: { pk?: string; key?: string; data?: string; value?: string }, i: number) => ({
          pk:   String(r.pk ?? r.key ?? i),
          data: String(r.data ?? r.value ?? JSON.stringify(r)),
        }));
      } catch (e) {
        toast.error('Invalid JSON: ' + (e as Error).message);
        return [];
      }
    }
    return text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => {
        const comma = l.indexOf(',');
        if (comma === -1) return { pk: l, data: '' };
        return { pk: l.slice(0, comma).trim(), data: l.slice(comma + 1).trim() };
      });
  }

  function buildCalls(rows: { pk: string; data: string }[]) {
    return rows.map(({ pk, data }) => ({
      target: tableAddr,
      allowFailure: false as const,
      callData: encodeFunctionData({
        abi: TABLE_ABI, functionName: 'write',
        args: [recordKey(tableName, pk.trim()), toHex(new TextEncoder().encode(data.trim() || pk.trim())), toHex(new TextEncoder().encode('__plaintext_demo__'))],
      }),
    }));
  }

  function handlePreview() {
    const rows = parseRows(raw);
    if (rows.length === 0) { toast.error('No valid rows found'); return; }
    setPreview(rows);
  }

  function handleSubmit() {
    if (preview.length === 0) return;
    const allCalls = buildCalls(preview);
    // Split into CHUNK_SIZE chunks — each chunk = 1 tx
    const built: typeof allCalls[] = [];
    for (let i = 0; i < allCalls.length; i += CHUNK_SIZE) {
      built.push(allCalls.slice(i, i + CHUNK_SIZE));
    }
    setChunks(built);
    setChunkIdx(0);
    setSubmitting(true);
    writeContract(
      { address: MULTICALL3_ADDRESS, abi: MULTICALL3_ABI, functionName: 'aggregate3', args: [built[0]] },
      { onError: (err) => { setSubmitting(false); toast.error(err.message?.split('\n')[0] ?? 'Batch failed'); } }
    );
  }

  const totalChunks  = Math.ceil(preview.length / CHUNK_SIZE);
  const isMultiChunk = totalChunks > 1;

  return (
    <div className="p-4 flex flex-col gap-3">
      {/* Demo warning */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2">
        <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-xs text-amber-300 font-medium">Demo mode — data stored unencrypted</p>
          <p className="text-xs text-amber-400/80 mt-0.5">
            Records are grouped into chunks of {CHUNK_SIZE} and each chunk is submitted as one Multicall3 transaction.
            Large imports require multiple wallet approvals (one per chunk).
          </p>
          <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
            <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
            <span className="text-[11px] text-amber-400">I understand this data is public</span>
          </label>
        </div>
      </div>

      {/* Format picker */}
      <div className="flex gap-2">
        <button
          onClick={() => { setFormat('csv'); setPreview([]); }}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${format === 'csv' ? 'border-violet-600 bg-violet-900/30 text-violet-300' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
        >CSV (pk,data)</button>
        <button
          onClick={() => { setFormat('json'); setPreview([]); }}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${format === 'json' ? 'border-violet-600 bg-violet-900/30 text-violet-300' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
        >JSON array</button>
      </div>

      <textarea
        value={raw}
        onChange={e => { setRaw(e.target.value); setPreview([]); }}
        rows={6}
        placeholder={format === 'csv'
          ? 'user-1,{"name":"Alice","age":30}\nuser-2,{"name":"Bob","age":25}'
          : '[{"pk":"user-1","data":"{\\"name\\":\\"Alice\\"}"},{"pk":"user-2","data":"{\\"name\\":\\"Bob\\"}"}]'}
        className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-500 font-mono resize-none"
      />

      {preview.length === 0 ? (
        <button
          onClick={handlePreview}
          disabled={!raw.trim() || !acknowledged}
          className="text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors"
        >
          Preview {raw.trim() ? `(${parseRows(raw).length} rows)` : ''}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="bg-zinc-800 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">{preview.length} records</span>
                {isMultiChunk && (
                  <span className="text-[10px] bg-sky-900/50 text-sky-300 px-1.5 py-0.5 rounded-full">
                    {totalChunks} txs × {CHUNK_SIZE} max
                  </span>
                )}
              </div>
              <button onClick={() => setPreview([])} className="text-zinc-500 hover:text-zinc-300">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="max-h-32 overflow-y-auto">
              {preview.map((r, i) => (
                <div key={i} className="flex gap-2 px-3 py-1.5 border-b border-zinc-800 last:border-0">
                  <span className="text-xs text-violet-400 font-mono shrink-0 w-20 truncate">{r.pk}</span>
                  <span className="text-xs text-zinc-400 font-mono truncate">{r.data}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Chunk progress bar shown during multi-chunk submit */}
          {submitting && isMultiChunk && (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-zinc-500">
                <span>Transaction {chunkIdx + 1} of {totalChunks}</span>
                <span>{Math.round(((chunkIdx) / totalChunks) * 100)}%</span>
              </div>
              <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all"
                  style={{ width: `${((chunkIdx) / totalChunks) * 100}%` }}
                />
              </div>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isPending || isConfirming || submitting}
            className="text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {isPending
              ? `Confirm tx ${chunkIdx + 1}/${totalChunks} in wallet…`
              : isConfirming
              ? `Confirming tx ${chunkIdx + 1}/${totalChunks}…`
              : isMultiChunk
              ? `Batch write ${preview.length} records (${totalChunks} txs, ${CHUNK_SIZE}/tx)`
              : `Batch write ${preview.length} records (1 tx)`}
          </button>
        </div>
      )}
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
  const [editing, setEditing]         = useState(false);
  const [editData, setEditData]       = useState('');
  const [delDoneHandled, setDelDoneHandled]     = useState(false);
  const [editDoneHandled, setEditDoneHandled]   = useState(false);

  const { data: rec, refetch: refetchRec } = useReadContract({
    address: tableAddr, abi: TABLE_ABI, functionName: 'read', args: [key],
  });
  const { data: collabs, refetch: refetchCollabs } = useReadContract({
    address: tableAddr, abi: TABLE_ABI, functionName: 'getCollaborators', args: [key],
    query: { enabled: showCollabs },
  });
  const { writeContract, data: delHash, isPending: delPending } = useWriteContract();
  const { isLoading: delConfirming, isSuccess: delDone } = useWaitForTransactionReceipt({ hash: delHash });
  const { writeContract: updateWrite, data: updHash, isPending: updPending } = useWriteContract();
  const { isLoading: updConfirming, isSuccess: updDone } = useWaitForTransactionReceipt({ hash: updHash });

  if (delDone && !delDoneHandled) {
    setDelDoneHandled(true);
    toast.success('Record deleted');
    onDone();
  }

  if (updDone && !editDoneHandled) {
    setEditDoneHandled(true);
    setEditing(false);
    toast.success('Record updated on-chain');
    refetchRec();
    onDone();
  }
  if (!updDone && editDoneHandled) setEditDoneHandled(false);

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

  // Use decoded plaintext as the record label, fall back to truncated hash
  const recordLabel = plaintext.length > 0 && plaintext !== '[binary]'
    ? (plaintext.length > 40 ? plaintext.slice(0, 40) + '…' : plaintext)
    : key.slice(0, 16) + '…';

  return (
    <div className="bg-zinc-900 border border-zinc-700/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
        aria-expanded={expanded}
        aria-label={`Record: ${recordLabel}`}
      >
        <span className="font-mono text-xs text-zinc-300 truncate max-w-[55%]">{recordLabel}</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-zinc-500">v{version.toString()} · {ts}</span>
          <span className="text-zinc-500 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3 border-t border-zinc-800">
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-zinc-500">Data (stored unencrypted in demo)</p>
              {!editing && (
                <button
                  onClick={() => { setEditing(true); setEditData(plaintext); }}
                  className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                  aria-label="Edit record"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              )}
            </div>
            {editing ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={editData}
                  onChange={e => setEditData(e.target.value)}
                  rows={4}
                  className="bg-zinc-800 border border-violet-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-violet-500 resize-none w-full"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const cipher = toHex(new TextEncoder().encode(editData.trim()));
                      const encKey = toHex(new TextEncoder().encode('__plaintext_demo__'));
                      updateWrite(
                        { address: tableAddr, abi: TABLE_ABI, functionName: 'update', args: [key, cipher, encKey] },
                        { onError: (err) => toast.error(err.message?.split('\n')[0] ?? 'Update failed') }
                      );
                    }}
                    disabled={updPending || updConfirming || !editData.trim()}
                    className="text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {updPending ? 'Confirm in wallet…' : updConfirming ? 'Updating…' : 'Save update'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <pre className="text-xs font-mono text-violet-400 bg-zinc-800 rounded p-2 whitespace-pre-wrap break-all">
                {plaintext}
              </pre>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-500 font-mono truncate">
              Key: {key.slice(0, 12)}…
            </span>
            <span className="text-xs text-zinc-500">
              Owner: <span className="font-mono text-zinc-400">{(owner as string).slice(0, 10)}…</span>
            </span>

            <button
              onClick={() => { setShowCollabs((s) => !s); if (!showCollabs) refetchCollabs(); }}
              className="text-xs text-violet-400 hover:text-violet-300 underline"
            >
              {showCollabs ? 'Hide' : 'Show'} collaborators
            </button>

            <button
              onClick={() => writeContract(
                { address: tableAddr, abi: TABLE_ABI, functionName: 'deleteRecord', args: [key] },
                { onError: (err) => toast.error(err.message?.split('\n')[0] ?? 'Delete failed') }
              )}
              disabled={delPending || delConfirming}
              aria-label="Delete record"
              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40 ml-auto border border-red-700/40 hover:border-red-600 rounded px-2 py-1 transition-colors"
            >
              {delPending ? 'Confirm in wallet…' : delConfirming ? 'Deleting…' : 'Delete'}
            </button>
          </div>

          {showCollabs && (
            <CollaboratorList
              tableAddr={tableAddr}
              recordKey={key}
              collabs={(collabs as string[]) ?? []}
              onGranted={() => refetchCollabs()}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Collaborator list + grant access ─────────────────────────────────────────

function CollaboratorList({
  tableAddr,
  recordKey: key,
  collabs,
  onGranted,
}: {
  tableAddr: `0x${string}`;
  recordKey: `0x${string}`;
  collabs: string[];
  onGranted: () => void;
}) {
  const [grantAddr, setGrantAddr] = useState('');
  const [grantRole, setGrantRole] = useState<number>(1);
  const [grantDoneHandled, setGrantDoneHandled] = useState(false);
  const { writeContract, data: grantHash, isPending: grantPending } = useWriteContract();
  const { isLoading: grantConfirming, isSuccess: grantDone } = useWaitForTransactionReceipt({ hash: grantHash });

  if (grantDone && !grantDoneHandled) {
    setGrantDoneHandled(true);
    toast.success('Access granted');
    setGrantAddr('');
    onGranted();
  }
  if (!grantDone && grantDoneHandled) setGrantDoneHandled(false);

  function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!isAddress(grantAddr)) { toast.error('Invalid wallet address'); return; }
    writeContract(
      {
        address: tableAddr, abi: TABLE_ABI, functionName: 'grantAccess',
        // role is uint8 (number), encryptedKeyForUser is empty bytes in demo mode
        args: [key, grantAddr as `0x${string}`, grantRole, '0x' as `0x${string}`],
      },
      { onError: (err) => toast.error(err.message?.split('\n')[0] ?? 'Grant failed') }
    );
  }

  return (
    <div className="bg-zinc-800 rounded-lg p-3 flex flex-col gap-3">
      <p className="text-xs text-zinc-500 uppercase tracking-widest">
        Collaborators ({collabs.length})
      </p>

      {collabs.length === 0 ? (
        <p className="text-zinc-600 text-xs">No collaborators yet.</p>
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

      {/* Grant access form */}
      <div className="pt-2 border-t border-zinc-700">
        <p className="text-[11px] text-zinc-500 mb-2 uppercase tracking-wider">Grant Access</p>
        <form onSubmit={handleGrant} className="flex flex-col gap-2">
          <input
            value={grantAddr}
            onChange={(e) => setGrantAddr(e.target.value)}
            placeholder="0x… wallet address"
            className="bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-500 font-mono"
          />
          <div className="flex gap-2">
            <select
              value={grantRole}
              onChange={(e) => setGrantRole(Number(e.target.value))}
              className="bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-violet-500 flex-1"
            >
              <option value={1}>VIEWER — read only</option>
              <option value={2}>EDITOR — read &amp; write</option>
              <option value={3}>OWNER — full control</option>
            </select>
            <button
              type="submit"
              disabled={grantPending || grantConfirming || !grantAddr.trim()}
              className="text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors shrink-0"
            >
              {grantPending ? 'Confirm…' : grantConfirming ? 'Granting…' : 'Grant'}
            </button>
          </div>
        </form>
      </div>
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
  const { writeContract, data: revokeHash, isPending } = useWriteContract();
  const { isLoading: revokeConfirming } = useWaitForTransactionReceipt({ hash: revokeHash });
  const isMe = me?.toLowerCase() === user.toLowerCase();

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="font-mono text-zinc-400">{user.slice(0, 10)}… {isMe && '(you)'}</span>
      <div className="flex items-center gap-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
          role === 3 ? 'bg-violet-900 text-violet-300' :
          role === 2 ? 'bg-sky-900 text-sky-300' :
          'bg-zinc-700 text-zinc-400'
        }`}>
          {roleLabel(Number(role ?? 0))}
        </span>
        {!isMe && (
          <button
            disabled={isPending || revokeConfirming}
            aria-label={`Revoke access for ${user}`}
            onClick={() => writeContract(
              { address: tableAddr, abi: TABLE_ABI, functionName: 'revokeAccess', args: [key, user as `0x${string}`] },
              { onError: (err) => toast.error(err.message?.split('\n')[0] ?? 'Revoke failed') }
            )}
            className="text-red-400 hover:text-red-300 disabled:opacity-40 transition-colors"
          >
            {isPending ? 'Confirm…' : revokeConfirming ? 'Revoking…' : 'Revoke'}
          </button>
        )}
      </div>
    </div>
  );
}
