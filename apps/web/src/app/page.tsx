export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-night-950 p-8 text-white">
      <div className="max-w-2xl space-y-8">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary-300">
            Club Atlético Gorriti
          </p>
          <h1 className="font-display text-4xl font-bold">Athlos para Club Atlético Gorriti</h1>
          <p className="text-lg text-slate-300">Sistema privado para la gestión del club.</p>
        </div>

        <div className="space-y-4 text-slate-300">
          <p>
            Centraliza las herramientas de trabajo para socios, cuenta corriente, padrones y
            administración, con acceso controlado para cada operador.
          </p>
          <p>
            Su objetivo es acompañar una gestión ordenada y responsable, prioriza información
            confiable y respeta los permisos de cada equipo.
          </p>
        </div>

        <a
          className="inline-flex rounded-md bg-primary-500 px-5 py-3 font-semibold text-night-950"
          href="/login"
        >
          Iniciar sesión
        </a>
      </div>
    </main>
  )
}
