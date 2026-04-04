'use client'

import Link from 'next/link'
import { useAppStore } from '@/store'
import { Database, ArrowRight } from 'lucide-react'

export default function TablesRootPage() {
  const { activeDatabase } = useAppStore()

  if (activeDatabase) {
    return (
      <div className="p-6 md:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Tables</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Active database: <span className="font-medium text-gray-700">{activeDatabase.name}</span>
          </p>
        </div>
        <Link
          href={`/databases/${activeDatabase.address}`}
          className="inline-flex items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-5 py-4 hover:bg-violet-100 transition-colors"
        >
          <Database className="h-5 w-5 text-violet-600" />
          <div>
            <p className="text-[14px] font-semibold text-violet-900">{activeDatabase.name}</p>
            <p className="text-[12px] text-violet-600 font-mono">{activeDatabase.address}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-violet-600 ml-auto" />
        </Link>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8">
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="h-16 w-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
          <Database className="h-8 w-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Select a database first</h3>
        <p className="text-[13px] text-gray-500 max-w-sm mb-6">
          Go to Databases and open a database to view and manage its tables.
        </p>
        <Link
          href="/databases"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-[13px] font-medium hover:bg-violet-700 transition-colors"
        >
          Go to Databases
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}
