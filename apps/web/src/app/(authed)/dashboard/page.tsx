/**
 * Dashboard landing page (`/dashboard`).
 *
 * PR 8a.2 ships a minimal placeholder so the post-login `router.push`
 * does not 404. PR 8a.3 replaces this with live health, master-counts,
 * and scheduler cards (auto-refresh every 30s).
 */
export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink-900">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-500">Resumen operativo del club.</p>
      </header>

      <section
        role="status"
        className="rounded-lg border border-ink-200 bg-surface-elevated p-8 text-center"
      >
        <p className="text-ink-500">Próximamente — disponible en la próxima versión.</p>
        <p className="mt-2 text-xs text-ink-300">
          Las tarjetas de salud del API, conteos de maestros y estado del scheduler se publican en
          PR 8a.3.
        </p>
      </section>
    </div>
  )
}
