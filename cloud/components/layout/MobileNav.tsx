'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Menu, X, Database, Table2, Settings, Plug, CreditCard, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/databases',    label: 'Databases',     icon: Database },
  { href: '/tables',       label: 'Tables',        icon: Table2 },
  { href: '/settings',     label: 'Settings',      icon: Settings },
  { href: '/integrations', label: 'Integrations',  icon: Plug },
  { href: '/billing',      label: 'Billing',       icon: CreditCard },
  { href: '/team',         label: 'Team',          icon: Users },
]

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen(true)}
        className="flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
      >
        <Menu className="h-4 w-4 text-gray-600" />
      </button>

      {/* Drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="fixed left-0 top-0 bottom-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Image src="/web3ql.png" alt="Web3QL" width={24} height={24} className="shrink-0" />
                <span className="text-[14px] font-semibold">Web3QL</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-3 space-y-0.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors',
                      active ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-100'
                    )}
                  >
                    <Icon className={cn('h-4 w-4', active ? 'text-violet-600' : 'text-gray-400')} />
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>
        </>
      )}
    </div>
  )
}
