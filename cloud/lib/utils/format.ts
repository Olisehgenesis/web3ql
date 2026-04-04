/**
 * Address and value formatting utilities
 */

export function shortAddress(address: string, chars = 4): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`
}

export function formatTimestamp(timestamp: bigint | number): string {
  const ms = typeof timestamp === 'bigint' ? Number(timestamp) * 1000 : timestamp * 1000
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))
}

export function formatRelativeTime(timestamp: bigint | number): string {
  const now = Date.now()
  const ms = typeof timestamp === 'bigint' ? Number(timestamp) * 1000 : timestamp * 1000
  const diffMs = now - ms
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay < 30) return `${diffDay}d ago`
  return formatTimestamp(timestamp)
}

export function formatCount(n: bigint | number | undefined): string {
  if (n === undefined || n === null) return '—'
  const num = typeof n === 'bigint' ? Number(n) : n
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toString()
}
