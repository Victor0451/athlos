import type { ReactNode } from 'react'

export function CollectionStatus({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'error' | 'neutral'
}) {
  const error = tone === 'error'
  return (
    <div aria-live={error ? 'assertive' : 'polite'} role={error ? 'alert' : 'status'}>
      {children}
    </div>
  )
}
