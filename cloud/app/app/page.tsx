import { redirect } from 'next/navigation'

// Legacy /app route — redirect to the new dashboard
export default function LegacyAppPage() {
  redirect('/databases')
}
