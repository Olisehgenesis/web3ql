import Navbar from "@/components/landing/Navbar";
import Hero   from "@/components/landing/Hero";
import Link   from "next/link";
import Image  from "next/image";
import { Button } from "@/components/ui/button";

const features = [
  { icon: "🔒", title: "Encrypted Records",  desc: "Every record is stored as encrypted ciphertext. Only you and your collaborators can read it." },
  { icon: "⛓️", title: "100% On-Chain",       desc: "Databases, tables, and records are smart contracts on Celo. No IPFS, no centralised storage." },
  { icon: "🔑", title: "Role-Based Access",   desc: "Grant Viewer, Editor, or Owner roles per record to any wallet address. Full on-chain access control." },
  { icon: "📊", title: "On-Chain Analytics",  desc: "Track query counts, active records, and collaborator activity directly from smart contract state." },
  { icon: "⚡", title: "Instant Deploy",      desc: "One transaction to create a database. Another to create a table. No DevOps, no infra, no waiting." },
  { icon: "🌐", title: "WalletConnect",       desc: "Connect with 600+ wallets via Reown AppKit. Works with MetaMask, Coinbase, Rainbow, and more." },
];

const steps = [
  { num: "01", title: "Connect Wallet",  desc: "Open the app and connect with any EVM wallet via WalletConnect." },
  { num: "02", title: "Create Database", desc: "Deploy a new on-chain database in one transaction." },
  { num: "03", title: "Create Tables",   desc: "Define your schema using familiar SQL syntax." },
  { num: "04", title: "Write and Query", desc: "Store encrypted records and share access with collaborators." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-black font-sans">
      <Navbar />
      <Hero />

      {/* ── Features ── */}
      <section className="py-20 border-b border-zinc-100">
        <div className="max-w-6xl mx-auto px-6">
          <div className="mb-12">
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-400 mb-2">Features</p>
            <h2 className="text-3xl font-bold text-black tracking-tight">Everything you need, on-chain</h2>
            <p className="text-zinc-500 mt-2 max-w-md text-sm leading-relaxed">
              Web3QL Cloud packages enterprise-grade database features into smart contracts you own.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-zinc-100 border border-zinc-100">
            {features.map((f) => (
              <div key={f.title} className="bg-white p-6 hover:bg-zinc-50 transition-colors">
                <span className="text-xl leading-none">{f.icon}</span>
                <h3 className="font-semibold text-black mt-3 text-sm">{f.title}</h3>
                <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="py-20 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-6">
          <div className="mb-12">
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 mb-2">How it works</p>
            <h2 className="text-3xl font-bold text-white tracking-tight">From zero to on-chain database in 4 steps</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-zinc-800">
            {steps.map((s, i) => (
              <div key={s.num} className="relative bg-zinc-950 p-6">
                <span className="text-4xl font-black text-zinc-700 leading-none">{s.num}</span>
                <h3 className="font-semibold text-white mt-4 text-sm">{s.title}</h3>
                <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">{s.desc}</p>
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-px w-px h-6 bg-zinc-700 -translate-y-1/2 z-10" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Code preview ── */}
      <section className="py-20 border-b border-zinc-100">
        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-400 mb-2">Developer First</p>
            <h2 className="text-3xl font-bold text-black tracking-tight leading-tight">SQL syntax you already know</h2>
            <p className="text-zinc-500 mt-3 text-sm leading-relaxed max-w-md">
              Define schemas with standard SQL. Store records as encrypted JSON. Access and share
              data — all enforced by smart contract logic.
            </p>
            <Button
              className="mt-7 bg-black text-white hover:bg-zinc-800 rounded-sm text-sm font-medium"
              size="sm"
              asChild
            >
              <Link href="/databases">Open Dashboard →</Link>
            </Button>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-7 font-mono text-sm">
            <div className="flex items-center gap-1.5 mb-5">
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
              <span className="ml-3 text-xs text-zinc-600">web3ql — cloud.sql</span>
            </div>
            <p className="text-zinc-600">{"-- 1. Create a database contract"}</p>
            <p className="text-zinc-300 mt-1">CREATE DATABASE <span className="text-white">users_db</span>;</p>
            <p className="text-zinc-600 mt-4">{"-- 2. Create a table"}</p>
            <p className="text-zinc-300 mt-1">CREATE TABLE <span className="text-white">users</span> (</p>
            <p className="text-zinc-400 ml-4">id    INT PRIMARY KEY,</p>
            <p className="text-zinc-400 ml-4">name  VARCHAR(100),</p>
            <p className="text-zinc-400 ml-4">age   INT</p>
            <p className="text-zinc-300">);</p>
            <p className="text-zinc-600 mt-4">{"-- 3. Insert encrypted records"}</p>
            <p className="text-zinc-300 mt-1">INSERT INTO <span className="text-white">users</span> VALUES <span className="text-zinc-400">(1, &apos;Alice&apos;, 28)</span>;</p>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 bg-black">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-white tracking-tight">Ready to deploy your first on-chain database?</h2>
          <p className="text-zinc-400 mt-3 text-sm">No credit card. No server. Just your wallet.</p>
          <div className="flex gap-3 justify-center mt-8 flex-wrap">
            <Button
              size="sm"
              className="bg-white text-black hover:bg-zinc-100 rounded-sm text-sm font-medium px-6"
              asChild
            >
              <Link href="/databases">Launch App →</Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-900 hover:text-white rounded-sm text-sm"
              asChild
            >
              <a href="https://celo-sepolia.blockscout.com/address/0xE3ABF868B6726398a2DeDC58D5F49cFc8C4a9F4F" target="_blank" rel="noreferrer">View Contract</a>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-zinc-200 bg-white px-8 py-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/web3ql.png" alt="Web3QL" width={22} height={22} className="shrink-0" />
            <span className="font-semibold text-sm text-black">Web3QL</span>
          </Link>
          <div className="flex gap-6">
            {["Features", "Docs", "Contact"].map((t) => (
              <Link key={t} href="#" className="hover:text-black transition-colors">{t}</Link>
            ))}
          </div>
          <span>Built on Celo · Powered by Reown · © 2026</span>
        </div>
      </footer>
    </div>
  );
}
