import { CreditCard, Zap, Database, Info } from 'lucide-react'

const GAS_INFO = [
  { action: 'Create Database', estimate: '~200,000 gas', celoEst: '~0.001 CELO' },
  { action: 'Create Table',    estimate: '~150,000 gas', celoEst: '~0.0008 CELO' },
  { action: 'Write Record',    estimate: '~80,000 gas',  celoEst: '~0.0004 CELO' },
  { action: 'Update Record',   estimate: '~60,000 gas',  celoEst: '~0.0003 CELO' },
  { action: 'Delete Record',   estimate: '~40,000 gas',  celoEst: '~0.0002 CELO' },
  { action: 'Grant Access',    estimate: '~70,000 gas',  celoEst: '~0.00035 CELO' },
]

export default function BillingPage() {
  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Billing</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">Gas costs for on-chain operations</p>
      </div>

      <div className="max-w-2xl space-y-4">
        {/* Info banner */}
        <div className="flex items-start gap-3 rounded-2xl bg-blue-50 border border-blue-100 p-4">
          <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-medium text-blue-900 mb-0.5">No subscription required</p>
            <p className="text-[13px] text-blue-700">
              Web3QL is a permissionless protocol. You only pay Celo network gas fees for transactions.
              There are no subscriptions, usage fees, or platform charges.
            </p>
          </div>
        </div>

        {/* Gas estimates */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-[15px] font-semibold text-gray-900">Gas Cost Estimates</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">Estimated costs on Celo Sepolia (testnet)</p>
          </div>
          <div className="divide-y divide-gray-100">
            {GAS_INFO.map((row) => (
              <div key={row.action} className="flex items-center gap-4 px-6 py-3">
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-gray-900">{row.action}</p>
                </div>
                <div className="text-right">
                  <p className="text-[13px] text-gray-700">{row.estimate}</p>
                  <p className="text-[12px] text-gray-400">{row.celoEst}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="px-6 py-3 bg-gray-50 rounded-b-2xl">
            <p className="text-[12px] text-gray-400">
              Estimates vary based on data size and network conditions. On testnet, use the{' '}
              <a
                href="https://celo.org/developers/faucet"
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-600 hover:underline"
              >
                Celo faucet
              </a>{' '}
              for test CELO.
            </p>
          </div>
        </div>

        {/* Faucet */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-[15px] font-semibold text-gray-900">Testnet Faucet</h2>
          </div>
          <div className="px-6 py-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
              <Zap className="h-5 w-5 text-green-600" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-medium text-gray-900">Get free test CELO</p>
              <p className="text-[12px] text-gray-500">Use the official Celo faucet to fund your testnet wallet.</p>
            </div>
            <a
              href="https://celo.org/developers/faucet"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-xl border border-gray-200 text-[13px] text-gray-700 hover:bg-gray-50 transition-colors shrink-0"
            >
              Open Faucet
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
