import { ImplementationContactForm } from './ImplementationContactForm'

export function ProductLanding() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-page text-ink-900">
      <header className="border-b border-ink-700 bg-night-900 px-5 py-4 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <span className="font-display text-lg font-bold tracking-wide">Athlos</span>
            <span className="ml-3 border-l border-ink-500 pl-3 font-mono text-[10px] uppercase tracking-widest text-ink-300">
              Gestión de clubes
            </span>
          </div>
          <a
            href="/login"
            className="min-h-11 rounded-md border border-ink-300 px-3 py-2 font-body text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Acceso de operadores
          </a>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-10 lg:py-16">
        <section className="grid gap-8 border-b border-ink-200 pb-12 lg:grid-cols-[1.2fr_0.8fr] lg:gap-16">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-accent">
              Producto tecnológico para clubes deportivos
            </p>
            <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold leading-tight sm:text-5xl">
              Una operación de club más clara, trazable y conectada.
            </h1>
            <p className="mt-5 max-w-2xl font-body text-lg text-ink-500">
              Athlos reúne la información y los procesos que sostienen la gestión diaria de un club:
              socios, afiliaciones, cuotas, cuentas corrientes y operaciones.
            </p>
            <a
              href="#implementation-contact"
              className="mt-6 inline-flex min-h-11 items-center rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Conversar sobre una implementación
            </a>
            <p className="mt-6 border-l-2 border-accent pl-4 font-body text-sm text-ink-500">
              <span className="font-display font-semibold text-ink-900">Edición actual:</span> Club
              Atlético Gorriti. Una implementación concreta que da forma al producto sin limitarlo a
              un solo club.
            </p>
          </div>

          <aside
            className="self-end border border-ink-200 bg-surface p-5"
            aria-label="Alcance de Athlos"
          >
            <p className="font-mono text-xs uppercase tracking-widest text-ink-500">
              Alcance del producto
            </p>
            <dl className="mt-4 divide-y divide-ink-200">
              <div className="py-3 first:pt-0">
                <dt className="font-display text-sm font-semibold text-ink-900">
                  Información de socios
                </dt>
                <dd className="mt-1 font-body text-sm text-ink-500">
                  Padrón, estados, contacto y legajo.
                </dd>
              </div>
              <div className="py-3">
                <dt className="font-display text-sm font-semibold text-ink-900">
                  Afiliaciones, cuotas y cuentas
                </dt>
                <dd className="mt-1 font-body text-sm text-ink-500">
                  Catálogo, débitos, pagos y movimientos.
                </dd>
              </div>
              <div className="py-3 last:pb-0">
                <dt className="font-display text-sm font-semibold text-ink-900">
                  Operación controlada
                </dt>
                <dd className="mt-1 font-body text-sm text-ink-500">
                  Seguimiento, auditoría y tareas programadas.
                </dd>
              </div>
            </dl>
          </aside>
        </section>

        <section className="border-b border-ink-200 py-12" aria-labelledby="capabilities-heading">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Capacidades</p>
          <h2
            id="capabilities-heading"
            className="mt-2 max-w-2xl font-display text-2xl font-bold sm:text-3xl"
          >
            Lo que Athlos resuelve, administra y gestiona
          </h2>
          <p className="mt-3 max-w-2xl font-body text-sm text-ink-500">
            Una base común para que cada club pueda ordenar su operación con estados explícitos,
            información consultable y trazabilidad.
          </p>
          <div className="mt-8 grid gap-x-8 gap-y-10 sm:grid-cols-2">
            <article className="border-t-2 border-accent pt-4">
              <p className="font-mono text-xs uppercase tracking-widest text-accent">01 · Socios</p>
              <h3 className="mt-2 font-display text-lg font-semibold text-ink-900">
                Gestionar el padrón de socios
              </h3>
              <p className="mt-2 font-body text-sm leading-6 text-ink-500">
                Buscar y filtrar socios, consultar estados y datos de contacto, mantener la ficha y
                acceder a su legajo, notas y auditoría.
              </p>
            </article>
            <article className="border-t-2 border-ink-300 pt-4">
              <p className="font-mono text-xs uppercase tracking-widest text-ink-500">
                02 · Afiliaciones
              </p>
              <h3 className="mt-2 font-display text-lg font-semibold text-ink-900">
                Ordenar los tipos de afiliación
              </h3>
              <p className="mt-2 font-body text-sm leading-6 text-ink-500">
                Consultar el catálogo vigente, sus códigos y letras, y revisar los socios asociados
                junto con el estado de cada asociación.
              </p>
            </article>
            <article className="border-t-2 border-ink-300 pt-4">
              <p className="font-mono text-xs uppercase tracking-widest text-ink-500">
                03 · Cuenta corriente
              </p>
              <h3 className="mt-2 font-display text-lg font-semibold text-ink-900">
                Gestionar cuotas y cuenta corriente
              </h3>
              <p className="mt-2 font-body text-sm leading-6 text-ink-500">
                Registrar débitos y pagos, y consultar el saldo, los créditos y los movimientos
                paginados de cada cuenta corriente.
              </p>
            </article>
            <article className="border-t-2 border-ink-300 pt-4">
              <p className="font-mono text-xs uppercase tracking-widest text-ink-500">
                04 · Operaciones
              </p>
              <h3 className="mt-2 font-display text-lg font-semibold text-ink-900">
                Mantener la operación bajo seguimiento
              </h3>
              <p className="mt-2 font-body text-sm leading-6 text-ink-500">
                Revisar la disponibilidad de las fuentes, el estado de tareas programadas, las
                excepciones y las notificaciones que requieren atención.
              </p>
            </article>
          </div>
        </section>

        <section className="grid gap-6 border-b border-ink-200 py-10 sm:grid-cols-[0.8fr_1.2fr] sm:items-start">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-accent">
              Una implementación con contexto
            </p>
            <h2 className="mt-2 font-display text-2xl font-bold">
              Diseñado para el trabajo real del club.
            </h2>
          </div>
          <p className="font-body text-base leading-7 text-ink-500">
            Athlos parte de problemas operativos concretos y los convierte en superficies de trabajo
            claras para los equipos del club. La edición de Gorriti es el primer caso visible; el
            producto está pensado para adaptarse a otras organizaciones deportivas.
          </p>
        </section>

        <div className="pt-12">
          <ImplementationContactForm />
        </div>
      </div>
    </main>
  )
}
