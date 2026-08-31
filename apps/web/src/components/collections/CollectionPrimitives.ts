export type CollectionStatusTone = 'error' | 'neutral'

export const collectionSurfaceClass =
  'min-w-0 border border-ink-200 bg-surface p-4 shadow-sm sm:p-6'
export const collectionSectionClass = `${collectionSurfaceClass} space-y-4`
export const collectionFieldClass =
  'min-h-11 w-full border border-ink-300 bg-surface px-3 font-body text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export const collectionButtonClass = {
  primary:
    'min-h-11 border border-accent bg-accent px-4 font-display text-sm font-semibold text-accent-foreground hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
  secondary:
    'min-h-11 border border-ink-300 bg-surface px-4 font-display text-sm font-semibold text-ink-700 hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
  danger:
    'min-h-11 border border-danger bg-danger px-4 font-display text-sm font-semibold text-white hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
} as const

export const collectionInlineStatusClass = (tone: CollectionStatusTone) =>
  `min-w-0 border px-4 py-3 font-body text-sm ${
    tone === 'error'
      ? 'border-danger bg-danger-soft text-ink-900'
      : 'border-info bg-info-soft text-ink-900'
  }`
