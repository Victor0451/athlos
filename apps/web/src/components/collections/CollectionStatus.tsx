import type { ReactNode } from 'react'
import { collectionInlineStatusClass, type CollectionStatusTone } from './CollectionPrimitives'

export function CollectionStatus({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: CollectionStatusTone
}) {
  const error = tone === 'error'
  return (
    <div
      aria-live={error ? 'assertive' : 'polite'}
      className={collectionInlineStatusClass(tone)}
      role={error ? 'alert' : 'status'}
    >
      {children}
    </div>
  )
}
