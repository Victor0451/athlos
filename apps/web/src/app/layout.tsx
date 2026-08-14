import type { Metadata } from 'next'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '../styles/tokens.css'
import './globals.css'
import { QueryProvider } from '@/providers/QueryProvider'
import { AuthProvider } from '@/providers/AuthProvider'
import { ToasterMount } from '@/components/ui/Toast'

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
            <AuthProvider>
              {children}
              <ToasterMount />
            </AuthProvider>
          </QueryProvider>
        </NuqsAdapter>
      </body>
    </html>
  )
}
