import Navbar from "@/components/landing/Navbar";
import Hero   from "@/components/landing/Hero";
import Link   from "next/link";
import Image  from "next/image";
import { Button } from "@/components/ui/button";

const features = [
  { icon: "🔒", title: "Encrypted Records",  desc: "Every record is stored as encrypted ciphertext. Only you and your collaborators can read it." },
  { icon: "⛓️", title: "100% On-Chain",       desc: "Databases, tables, and records are smart contracts on Celo. No IPFS, no centralised storage." },
  { icon: "🔑", title: "Role-Based Access",   desc: "Grant Viewer, Editor, or Owner roles per record to any wallet address. Full on-chain access control." },
];

const steps = [
  { num: "01", title: "Connect Wallet",  desc: "Open the app and connect with any EVM wallet via WalletConnect." },
  { num: "02", title: "Create Database", desc: "Deploy a new on-chain database in one transaction." },
  { num: "03", title: "Create Tables",   desc: "Define your schema using familiar SQL syntax." },
  { num: "04", title: "Write and Query", desc: "Store encrypted records and share access with collaborators." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-grid text-black font-sans">
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-zinc-100 border border-zinc-100">
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

      {/* ── Comparison table ── */}
      <section className="py-20 border-b border-zinc-100">
        <div className="max-w-6xl mx-auto px-6">
          <div className="mb-12">
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-400 mb-2">Why Web3QL</p>
            <h2 className="text-3xl font-bold text-black tracking-tight">How we compare</h2>
            <p className="text-zinc-500 mt-2 max-w-md text-sm leading-relaxed">
              Web3QL is the only database that combines the query power of SQL, the flexibility of
              MongoDB, and true on-chain ownership — nobody, not even us, can read or delete your data.
            </p>
          </div>

          {/* table wrapper */}
          <div className="overflow-x-auto border border-zinc-200">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="text-left px-5 py-3.5 font-semibold text-black bg-zinc-50 w-48">Feature</th>
                  {[
                    { name: "PostgreSQL",  sub: "Relational SQL"     },
                    { name: "MongoDB",     sub: "Document NoSQL"     },
                    { name: "Firebase",    sub: "Google Cloud BaaS"  },
                    { name: "Tableland",   sub: "Web3 SQL"           },
                    { name: "Web3QL",      sub: "On-Chain Encrypted", highlight: true },
                  ].map((col) => (
                    <th
                      key={col.name}
                      className={`text-center px-5 py-3.5 font-semibold ${
                        col.highlight
                          ? "bg-black text-white"
                          : "bg-zinc-50 text-black"
                      }`}
                    >
                      <span className="block">{col.name}</span>
                      <span className={`block text-xs font-normal mt-0.5 ${col.highlight ? "text-zinc-400" : "text-zinc-400"}`}>
                        {col.sub}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { feature: "Data ownership",          pg: "❌ Server owner",    mongo: "❌ Atlas/cloud",    fire: "❌ Google",         tbl: "⚠️ Validators",          w3ql: "✅ Your wallet"      },
                  { feature: "End-to-end encryption",   pg: "⚠️ TLS only",        mongo: "⚠️ TLS only",       fire: "⚠️ TLS only",       tbl: "❌ Plaintext on-chain",  w3ql: "✅ NaCl per-record"  },
                  { feature: "Permissionless deploy",   pg: "❌ Infra required",  mongo: "❌ Atlas account",  fire: "❌ Google account",  tbl: "⚠️ Validator set",       w3ql: "✅ One transaction"  },
                  { feature: "Per-record access control", pg: "⚠️ Row-level (server)", mongo: "⚠️ Field-level (server)", fire: "⚠️ Rules (server)", tbl: "❌ Table-level only", w3ql: "✅ On-chain per key" },
                  { feature: "Gasless writes (relay)",  pg: "✅ Native",          mongo: "✅ Native",         fire: "✅ Native",          tbl: "❌ User pays gas",       w3ql: "✅ Meta-tx relay"    },
                  { feature: "SQL-style schema",        pg: "✅ Full SQL",        mongo: "❌ Schema-less",    fire: "❌ NoSQL rules",     tbl: "✅ SQLite subset",       w3ql: "✅ SQL-like"         },
                  { feature: "No vendor lock-in",       pg: "⚠️ DB engine",       mongo: "⚠️ BSON format",   fire: "❌ Google stack",    tbl: "⚠️ Tableland protocol",  w3ql: "✅ Open contracts"   },
                  { feature: "Self-hostable",           pg: "✅ Yes",             mongo: "✅ Yes",            fire: "❌ No",              tbl: "❌ No",                  w3ql: "✅ Deploy your own"  },
                  { feature: "No server / zero infra",  pg: "❌ Requires server", mongo: "❌ Requires server",fire: "✅ Managed",         tbl: "⚠️ Off-chain nodes",     w3ql: "✅ Fully on-chain"   },
                  { feature: "Programmable with SDK",   pg: "✅ Many clients",    mongo: "✅ Official SDK",   fire: "✅ Official SDK",    tbl: "⚠️ Limited",             w3ql: "✅ TypeScript SDK"   },
                ].map((row, i) => (
                  <tr key={row.feature} className={`border-b border-zinc-100 ${i % 2 === 0 ? "" : "bg-zinc-50/50"}`}>
                    <td className="px-5 py-3 font-medium text-black text-xs">{row.feature}</td>
                    <td className="px-5 py-3 text-center text-xs text-zinc-600">{row.pg}</td>
                    <td className="px-5 py-3 text-center text-xs text-zinc-600">{row.mongo}</td>
                    <td className="px-5 py-3 text-center text-xs text-zinc-600">{row.fire}</td>
                    <td className="px-5 py-3 text-center text-xs text-zinc-600">{row.tbl}</td>
                    <td className="px-5 py-3 text-center text-xs font-semibold bg-zinc-950 text-white">{row.w3ql}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* bottom callout */}
          <div className="mt-8 grid sm:grid-cols-3 gap-px bg-zinc-100 border border-zinc-100">
            {[
              { icon: "🔏", title: "Only you can read it", desc: "NaCl X25519 encryption means your data is ciphertext on-chain. Not even Web3QL can decrypt it." },
              { icon: "⛓️", title: "Unstoppable & uncensorable", desc: "Data lives inside smart contracts on Celo. No company can shut down your database." },
              { icon: "🔑", title: "Share on your terms", desc: "Grant Viewer, Editor, or Owner access per record directly on-chain — no middleware needed." },
            ].map((c) => (
              <div key={c.title} className="bg-white p-6">
                <span className="text-xl">{c.icon}</span>
                <h3 className="font-semibold text-black mt-3 text-sm">{c.title}</h3>
                <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">{c.desc}</p>
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
