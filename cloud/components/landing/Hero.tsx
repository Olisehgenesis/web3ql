'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import FloatingCards from './FloatingCards';
import { toast } from 'sonner';

interface PlatformStats {
  databases: string;
  tables:    string;
  records:   string;
  gasSaved:  string;
}

function useStats(): PlatformStats {
  const [stats, setStats] = useState<PlatformStats>({
    databases: '—',
    tables:    '—',
    records:   '—',
    gasSaved:  '—',
  });

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((data) => {
        if (data.formatted) setStats(data.formatted);
      })
      .catch(() => {/* keep defaults */});
  }, []);

  return stats;
}

export default function Hero() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const stats = useStats();

  function handleWaitlist(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      toast.error('Enter a valid email address');
      return;
    }
    // TODO: wire to a real waitlist API (e.g. POST /api/waitlist)
    setSubmitted(true);
    toast.success('You\'re on the list! We\'ll be in touch.');
  }

  return (
    <section className="py-20 border-b border-zinc-100">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-2 items-center gap-16">

          {/* ── LEFT ──────────────────────────────────────── */}
          <div className="flex flex-col">

            {/* Status tag */}
            <span className="inline-flex items-center gap-2 self-start bg-zinc-50 border border-zinc-200 text-zinc-500 text-xs font-medium px-3 py-1 rounded-sm mb-6 tracking-wide">
              <span className="w-1.5 h-1.5 bg-black rounded-full" />
              Now live on Celo Sepolia
            </span>

            {/* Headline */}
            <h1 className="text-5xl font-bold leading-[1.15] tracking-tight text-black">
              Build Encrypted<br />
              Databases On-Chain
            </h1>

            {/* Supporting text */}
            <p className="text-base text-zinc-500 mt-4 leading-relaxed max-w-[360px]">
              Deploy SQL-style databases as smart contracts on Celo.
              Per-record access control. No servers. No backend.
            </p>

            {/* Email + CTA */}
            {submitted ? (
              <div className="mt-8 max-w-sm flex items-center gap-2 text-sm text-zinc-600 border border-zinc-200 rounded-sm px-4 py-2 bg-zinc-50">
                <span className="text-green-600">✓</span> You&apos;re on the list!
              </div>
            ) : (
              <form onSubmit={handleWaitlist} className="flex gap-2 mt-8 max-w-sm">
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  aria-label="Email address for waitlist"
                  className="flex-1 h-9 rounded-sm border-zinc-300 text-sm focus-visible:ring-0 focus-visible:border-black"
                />
                <Button
                  type="submit"
                  className="bg-black text-white hover:bg-zinc-800 rounded-sm h-9 px-5 text-sm font-medium"
                >
                  Get Started
                </Button>
              </form>
            )}

            <p className="text-xs text-zinc-400 mt-2">
              Free to start · No credit card required
            </p>

            {/* Stats — live from chain via /api/stats */}
            <div className="flex gap-8 mt-8 pt-6 border-t border-zinc-100">
              {[
                { label: 'Databases deployed', value: stats.databases },
                { label: 'On-chain records',   value: stats.records   },
                { label: 'Gas saved',          value: stats.gasSaved  },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-2xl font-bold text-black tracking-tight leading-none">{s.value}</p>
                  <p className="text-xs text-zinc-400 mt-1">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT ─────────────────────────────────────── */}
          <div className="hidden md:block">
            <FloatingCards />
          </div>

        </div>
      </div>
    </section>
  );
}
