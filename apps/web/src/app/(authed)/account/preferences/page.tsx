export default function PreferencesPage() {
  return (
    <main className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Preferencias</p>
        <h1 className="font-display text-2xl font-bold text-ink-900">
          Preferencias de notificaciones
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Configurá cómo querés recibir avisos operativos.
        </p>
      </header>
      <section className="rounded-lg border border-ink-100 bg-surface p-4 shadow-sm">
        <p className="rounded-lg border border-warning bg-warning-soft p-3 text-sm text-warning">
          Las preferencias de notificaciones son de solo lectura por el momento.
        </p>
      </section>
    </main>
  )
}
