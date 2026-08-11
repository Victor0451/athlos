import { ImplementationContactForm } from './ImplementationContactForm'

export function ProductLanding() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-page text-ink-900">
      <header className="border-b border-ink-700 bg-night-900 px-5 py-4 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <span className="font-display text-lg font-bold tracking-wide">Athlos</span>
          <a
            href="/login"
            className="min-h-11 rounded-md border border-ink-300 px-3 py-2 font-body text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Operator login
          </a>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 lg:grid-cols-[1fr_1.1fr] lg:py-16">
        <section>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">
            Club management product
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold leading-tight sm:text-5xl">
            Athlos keeps club work clear, accountable, and connected.
          </h1>
          <p className="mt-5 max-w-xl font-body text-lg text-ink-500">
            Club Atlético Gorriti is the current Athlos edition: a grounded implementation shaped by
            real club operations.
          </p>
          <a
            href="#implementation-contact"
            className="mt-6 inline-flex min-h-11 items-center rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Discuss implementation
          </a>
          <div className="mt-8 border-l-2 border-accent pl-4">
            <p className="font-display text-base font-semibold">Context before workflow</p>
            <p className="mt-1 font-body text-sm text-ink-500">
              Start with your team, constraints, and the problem that needs attention.
            </p>
          </div>
        </section>
        <ImplementationContactForm />
      </div>
    </main>
  )
}
