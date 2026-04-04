'use client'

import { usePathname } from 'next/navigation'
import { Bell, Search, ChevronRight } from 'lucide-react'
import { useAppKitAccount } from '@reown/appkit/react'
import { useAppKit } from '@reown/appkit/react'
import { shortAddress } from '@/lib/utils/format'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const BREADCRUMB_MAP: Record<string, string> = {
  '/databases':    'Databases',
  '/tables':       'Tables',
  '/settings':     'Settings',
  '/integrations': 'Integrations',
  '/billing':      'Billing',
  '/team':         'Team',
}

function Breadcrumb() {
  const pathname = usePathname()
  const parts = pathname.split('/').filter(Boolean)
  
  return (
    <div className="flex items-center gap-1.5 text-[13px]">
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1
        const isAddress = part.startsWith('0x') && part.length > 20
        const label = isAddress
          ? shortAddress(part, 4)
          : part.charAt(0).toUpperCase() + part.slice(1)

        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-300" />}
            <span className={cn(isLast ? 'text-gray-900 font-medium' : 'text-gray-500')}>
              {label}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export function Topbar() {
  const { address, isConnected } = useAppKitAccount()
  const { open } = useAppKit()

  const initials = address ? address.slice(2, 4).toUpperCase() : '?'

  return (
    <div className="flex items-center gap-4 h-14 px-6 w-full">
      {/* Breadcrumb */}
      <div className="flex-1 min-w-0">
        <Breadcrumb />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Search trigger */}
        <button
          className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-gray-200 text-[13px] text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-colors duration-150 min-w-[160px]"
        >
          <Search className="h-3.5 w-3.5" />
          Search...
          <span className="ml-auto text-[11px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-400 font-mono">⌘K</span>
        </button>

        {/* Notifications */}
        <button className="relative flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors duration-150">
          <Bell className="h-4 w-4 text-gray-500" />
        </button>

        {/* Account */}
        {isConnected && address ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-xl border border-gray-200 pl-1 pr-3 py-1 hover:bg-gray-50 transition-colors duration-150">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                </Avatar>
                <span className="text-[13px] font-mono text-gray-600">{shortAddress(address)}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Wallet</DropdownMenuLabel>
              <DropdownMenuItem className="font-mono text-[12px]" onClick={() => open({ view: 'Account' })}>
                {shortAddress(address, 6)}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => open({ view: 'Networks' })}>
                Switch Network
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => open({ view: 'Account' })}>
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            onClick={() => open()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 text-white text-[13px] font-medium hover:bg-violet-700 transition-colors duration-150"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </div>
  )
}
