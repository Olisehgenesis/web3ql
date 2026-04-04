'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 h-14 w-full border-b border-zinc-200 bg-white">
      <div className="max-w-6xl mx-auto px-6 h-full flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <Image src="/web3ql.png" alt="Web3QL" width={28} height={28} className="shrink-0" />
          <span className="font-semibold text-sm text-black tracking-tight">Web3QL</span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-7">
          {['Features', 'Pricing', 'Docs', 'About'].map((item) => (
            <Link
              key={item}
              href="#"
              className="text-sm text-zinc-500 hover:text-black transition-colors"
            >
              {item}
            </Link>
          ))}
        </nav>

        {/* CTA */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-sm font-normal text-zinc-600 hover:text-black hover:bg-transparent px-3"
            asChild
          >
            <Link href="/login">Log in</Link>
          </Button>
          <Button
            size="sm"
            className="bg-black text-white hover:bg-zinc-800 text-sm font-medium rounded-sm px-4 h-8"
            asChild
          >
            <Link href="/databases">Sign up</Link>
          </Button>
        </div>

      </div>
    </header>
  );
}
