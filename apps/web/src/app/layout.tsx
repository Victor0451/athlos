import type { Metadata } from 'next'
import '../styles/tokens.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'Athlos',
  description: 'Athlos — Club Atlético Gorriti operator console',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-surface text-ink-700 font-body antialiased">{children}</body>
    </html>
  )
}
