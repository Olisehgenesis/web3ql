'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Database,
  Table2,
  Settings,
  Plug,
  CreditCard,
  Users,
  LayoutDashboard,
  ChevronDown,
  Circle,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { shortAddress } from '@/lib/utils/format'

const NAV_MAIN = [
  { href: '/databases', label: 'Databases',  icon: Database },
  { href: '/tables',    label: 'Tables',     icon: Table2 },
  { href: '/test',      label: 'Explorer',   icon: Circle },
]

const NAV_SETTINGS = [
  { href: '/settings',     label: 'Settings',      icon: Settings },
  { href: '/integrations', label: 'Integrations',  icon: Plug },
  { href: '/billing',      label: 'Billing',       icon: CreditCard },
  { href: '/team',         label: 'Team',          icon: Users },
]

function NavItem({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string
  label: string
  icon: React.ElementType
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors duration-150',
        active
          ? 'bg-violet-50 text-violet-700'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      )}
    >
      <Icon
        className={cn('h-4 w-4 shrink-0', active ? 'text-violet-600' : 'text-gray-400')}
      />
      {label}
    </Link>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { activeDatabase, clearActiveDatabase } = useAppStore()

  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-gray-200 bg-white h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-gray-100">
        <Image src="/web3ql.png" alt="Web3QL" width={28} height={28} className="shrink-0" />
        <span className="text-[15px] font-semibold text-gray-900">Web3QL</span>
        <span className="ml-auto text-[10px] font-medium bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-md">
          Testnet
        </span>
      </div>

      {/* Active database context */}
      {activeDatabase && (
        <div className="px-3 py-3 border-b border-gray-100">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-1">
            Active Database
          </p>
          <Link
            href={`/databases/${activeDatabase.address}`}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors duration-150 group"
          >
            <div className="h-5 w-5 rounded-md bg-violet-100 flex items-center justify-center shrink-0">
              <Database className="h-3 w-3 text-violet-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-gray-900 truncate">{activeDatabase.name}</p>
              <p className="text-[11px] text-gray-400 font-mono truncate">
                {shortAddress(activeDatabase.address)}
              </p>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>
        </div>
      )}

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
          Workspace
        </p>
        {NAV_MAIN.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname === item.href || pathname.startsWith(item.href + '/')}
          />
        ))}

        <div className="pt-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
            Account
          </p>
          {NAV_SETTINGS.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              active={pathname === item.href}
            />
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-gray-100">
        <a
          href="https://celo-sepolia.blockscout.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors duration-150"
        >
          <Circle className="h-2 w-2 fill-green-500 text-green-500 shrink-0" />
          <span>Celo Sepolia</span>
          <ExternalLink className="h-3 w-3 ml-auto" />
        </a>
      </div>
    </aside>
  )
}
