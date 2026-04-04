'use client'

import { useState } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { isAddress } from 'viem'
import { CHAIN_ID, FACTORY_ADDRESS, CLOUD_DB_ADDRESS } from '@/lib/contracts'
import { shortAddress } from '@/lib/utils/format'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store'
import { Database, Network, Info, ExternalLink, PlugZap } from 'lucide-react'

function SettingRow({
  label,
  value,
  mono,
  href,
}: {
  label: string
  value: string
  mono?: boolean
  href?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <p className="text-[13px] text-gray-500 shrink-0 w-40">{label}</p>
      <div className="flex items-center gap-2 min-w-0">
        {mono ? (
          <span className="font-mono text-[12px] text-gray-700 break-all">{value}</span>
        ) : (
          <span className="text-[13px] text-gray-900">{value}</span>
        )}
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="shrink-0">
            <ExternalLink className="h-3.5 w-3.5 text-gray-400 hover:text-violet-600 transition-colors" />
          </a>
        )}
      </div>
    </div>
  )
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="px-6 divide-y divide-gray-100">{children}</div>
    </div>
  )
}

function CustomDeploymentSection() {
  const { customFactoryAddress, setCustomFactoryAddress } = useAppStore()
  const [draft, setDraft] = useState(customFactoryAddress ?? '')
  const isValid = draft === '' || isAddress(draft)
  const isCustomActive = !!customFactoryAddress

  const handleSave = () => {
    setCustomFactoryAddress(draft.trim() || null)
  }
  const handleClear = () => {
    setDraft('')
    setCustomFactoryAddress(null)
  }

  return (
    <SettingSection title="Custom Deployment">
      <div className="py-4 space-y-3">
        <p className="text-[12px] text-gray-500">
          If you have deployed your own Web3QL Factory contract, paste its address here.
          All database reads and creates will use it instead of the default.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="custom-factory" className="text-[12px]">Factory address</Label>
          <div className="flex gap-2">
            <Input
              id="custom-factory"
              placeholder={FACTORY_ADDRESS}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={`font-mono text-[12px] flex-1 ${!isValid ? 'border-red-300 focus-visible:ring-red-300' : ''}`}
            />
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isValid || draft === (customFactoryAddress ?? '')}
            >
              Save
            </Button>
            {isCustomActive && (
              <Button size="sm" variant="outline" onClick={handleClear}>
                Reset
              </Button>
            )}
          </div>
          {!isValid && (
            <p className="text-[11px] text-red-500">Not a valid EVM address</p>
          )}
        </div>
        {isCustomActive && (
          <div className="flex items-center gap-2 rounded-lg bg-violet-50 border border-violet-100 px-3 py-2">
            <PlugZap className="h-3.5 w-3.5 text-violet-600 shrink-0" />
            <p className="text-[12px] text-violet-700">
              Using custom factory: <span className="font-mono">{shortAddress(customFactoryAddress!, 8)}</span>
            </p>
            <a
              href={`https://celo-sepolia.blockscout.com/address/${customFactoryAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto shrink-0"
            >
              <ExternalLink className="h-3 w-3 text-violet-400 hover:text-violet-700" />
            </a>
          </div>
        )}
      </div>
    </SettingSection>
  )
}

export default function SettingsPage() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { activeDatabase } = useAppStore()

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">Network and account configuration</p>
      </div>

      <div className="max-w-2xl space-y-4">
        {/* Wallet */}
        <SettingSection title="Wallet">
          <SettingRow
            label="Status"
            value={isConnected ? 'Connected' : 'Not connected'}
          />
          {address && (
            <SettingRow
              label="Address"
              value={address}
              mono
              href={`https://celo-sepolia.blockscout.com/address/${address}`}
            />
          )}
          <SettingRow
            label="Chain ID"
            value={chainId?.toString() ?? '—'}
          />
          <div className="flex items-start justify-between gap-4 py-3">
            <p className="text-[13px] text-gray-500 shrink-0 w-40">Network</p>
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-gray-900">
                {chainId === CHAIN_ID ? 'Celo Sepolia' : `Chain ${chainId}`}
              </span>
              {chainId === CHAIN_ID ? (
                <Badge variant="success">Correct</Badge>
              ) : (
                <Badge variant="warning">Wrong Network</Badge>
              )}
            </div>
          </div>
        </SettingSection>

        {/* Active database */}
        <SettingSection title="Active Database">
          {activeDatabase ? (
            <>
              <SettingRow label="Name" value={activeDatabase.name} />
              <SettingRow
                label="Address"
                value={activeDatabase.address}
                mono
                href={`https://celo-sepolia.blockscout.com/address/${activeDatabase.address}`}
              />
            </>
          ) : (
            <div className="py-4 text-[13px] text-gray-400">No active database selected.</div>
          )}
        </SettingSection>

        {/* Protocol */}
        <SettingSection title="Protocol Contracts">
          <SettingRow
            label="Factory"
            value={FACTORY_ADDRESS}
            mono
            href={`https://celo-sepolia.blockscout.com/address/${FACTORY_ADDRESS}`}
          />
          <SettingRow
            label="Cloud DB"
            value={CLOUD_DB_ADDRESS}
            mono
            href={`https://celo-sepolia.blockscout.com/address/${CLOUD_DB_ADDRESS}`}
          />
          <SettingRow label="Deployed on" value="Celo Sepolia Testnet" />
          <SettingRow label="Required Chain ID" value={CHAIN_ID.toString()} />
        </SettingSection>

        {/* Custom deployment */}
        <CustomDeploymentSection />

        {/* Info */}
        <div className="flex items-start gap-3 rounded-2xl bg-blue-50 border border-blue-100 p-4">
          <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-[13px] text-blue-700">
            Web3QL is a fully on-chain database system. All data is stored directly on Celo Sepolia.
            There is no off-chain server or backend.
          </p>
        </div>
      </div>
    </div>
  )
}
