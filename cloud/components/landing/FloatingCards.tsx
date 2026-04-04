'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';

/* ── types ────────────────────────────────────────────────────── */
interface LiveStats {
  totalDatabases: number;
  totalTables:    number;
  totalRecords:   number;
  gasSavedUSD:    number;
  weeklyActivity: number[];
}

/* ── helpers ──────────────────────────────────────────────────── */
function StatRow({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
      <span className="text-xs text-zinc-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-black">{value}</span>
        {delta && <span className="text-xs text-zinc-400">{delta}</span>}
      </div>
    </div>
  );
}

function ActivityBars({ heights }: { heights: number[] }) {
  const max = Math.max(...heights, 1); // avoid div/0
  return (
    <div className="flex items-end gap-1 h-10 mt-1">
      {heights.map((h, i) => (
        <div
          key={i}
          className="flex-1 bg-black rounded-sm"
          style={{ height: `${Math.round((h / max) * 40)}px`, opacity: 0.6 + (i / heights.length) * 0.4 }}
        />
      ))}
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k+`;
  return n.toLocaleString();
}

/* ── cards ────────────────────────────────────────────────────── */
function MetricsCard({ stats }: { stats: LiveStats | null }) {
  return (
    <Card className="absolute top-0 right-0 w-56 border border-zinc-200 bg-white shadow-none">
      <div className="p-4">
        <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest mb-3">
          Platform Stats
        </p>
        <StatRow label="Databases" value={stats ? fmt(stats.totalDatabases) : '—'} />
        <StatRow label="Tables"    value={stats ? fmt(stats.totalTables)    : '—'} />
        <StatRow label="Records"   value={stats ? fmt(stats.totalRecords)   : '—'} />
      </div>
    </Card>
  );
}

function ActivityCard({ heights }: { heights: number[] }) {
  return (
    <Card className="absolute top-[168px] left-0 w-52 border border-zinc-200 bg-white shadow-none">
      <div className="p-4">
        <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest">
          Write Activity
        </p>
        <p className="text-xs text-zinc-400 mt-0.5 mb-3">Last 7 days</p>
        <ActivityBars heights={heights} />
        <div className="flex justify-between mt-2">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i} className="text-[9px] text-zinc-400 flex-1 text-center">
              {d}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

function GasCard({ usd }: { usd: number }) {
  const label = usd >= 1_000_000 ? `$${(usd / 1_000_000).toFixed(1)}M`
              : usd >= 1_000     ? `$${Math.round(usd / 1_000)}k`
              : usd > 0          ? `$${Math.round(usd)}`
              : '—';
  // scale bar up to $50k as 100%
  const pct = Math.min(100, usd > 0 ? Math.round((usd / 50_000) * 100) : 0);

  return (
    <Card className="absolute bottom-6 right-4 w-48 border border-zinc-200 bg-white shadow-none">
      <div className="p-4">
        <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest mb-2">
          Gas Saved
        </p>
        <p className="text-3xl font-bold text-black tracking-tight leading-none">{label}</p>
        <p className="text-xs text-zinc-400 mt-1">vs. centralised infra</p>
        <div className="mt-3 h-1 bg-zinc-100 rounded-full">
          <div className="h-1 bg-black rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Card>
  );
}

/* ── main export ─────────────────────────────────────────────── */
export default function FloatingCards() {
  const [stats, setStats] = useState<LiveStats | null>(null);

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((data: LiveStats) => setStats(data))
      .catch(() => {/* keep null — cards render placeholders */});
  }, []);

  const activity = stats?.weeklyActivity ?? [0, 0, 0, 0, 0, 0, 0];

  return (
    <div className="relative h-[420px] w-full select-none">
      <MetricsCard stats={stats} />
      <ActivityCard heights={activity} />
      <GasCard usd={stats?.gasSavedUSD ?? 0} />
    </div>
  );
}
