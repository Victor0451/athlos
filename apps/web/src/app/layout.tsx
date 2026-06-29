import type { Metadata } from 'next'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import '../styles/tokens.css'
import './globals.css'
import { QueryProvider } from '@/providers/QueryProvider'
import { AuthProvider } from '@/providers/AuthProvider'

export const metadata: Metadata = {
  title: 'Athlos',
  description: 'Athlos — Club Atlético Gorriti operator console',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-surface text-ink-700 font-body antialiased">
        <NuqsAdapter>
          <QueryProvider>
            <AuthProvider>{children}</AuthProvider>
          </QueryProvider>
        </NuqsAdapter>
      </body>
    </html>
  )
}
