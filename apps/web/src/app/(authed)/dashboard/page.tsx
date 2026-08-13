'use client'

import { useAuth } from '@/lib/use-auth'
import { NotificationSummary } from '@/components/dashboard/NotificationSummary'
import { OperationsAttention } from '@/components/dashboard/OperationsAttention'
import { SociosSummary } from '@/components/dashboard/SociosSummary'
import { WorkspaceCards } from '@/components/dashboard/WorkspaceCards'
import { ClubStatusDashboard } from '@/components/dashboard/ClubStatusDashboard'

export default function DashboardPage() {
  const { user } = useAuth()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink-900">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-500">Resumen operativo del club.</p>
      </header>

      {user ? <WorkspaceCards role={user.role} /> : null}
      <ClubStatusDashboard />
      <div className="grid gap-4 lg:grid-cols-2">
        <SociosSummary />
        <NotificationSummary />
      </div>
      <OperationsAttention isAdmin={user?.role === 'ADMIN'} />
    </div>
  )
}
