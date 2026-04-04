import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'
import { MobileNav } from '@/components/layout/MobileNav'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900" style={{ fontFamily: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif' }}>
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar — desktop only */}
        <Sidebar />

        {/* Main content column */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Sticky topbar */}
          <div className="sticky top-0 z-30 flex items-center h-14 border-b border-gray-200 bg-white">
            {/* Mobile: nav drawer trigger + logo */}
            <div className="flex items-center gap-3 px-4 lg:hidden">
              <MobileNav />
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-lg bg-violet-600 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-white">W</span>
                </div>
                <span className="text-[14px] font-semibold">Web3QL</span>
              </div>
            </div>
            {/* Desktop: full topbar content */}
            <div className="flex-1 lg:flex hidden">
              <Topbar />
            </div>
            {/* Mobile: right actions from topbar */}
            <div className="flex-1 flex lg:hidden justify-end">
              <Topbar />
            </div>
          </div>

          {/* Scrollable page area */}
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
