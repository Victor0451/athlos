/**
 * Monogram — coloured initials avatar for a socio (PR 8b.2 second slice).
 *
 * Renders `<nombre-initial><apellido-initial>` in a coloured circle.
 * The background hue is a stable hash of the full name so the same
 * socio always lands on the same color across page navigations —
 * useful for skimming a list without having to read every cell.
 *
 * Spanish-aware accent stripping: `García` → `G`, `María` → `M`, so
 * accents never lose the letter entirely when they happen to land on
 * the kept initial. Multi-word last names (`García López`) keep the
 * first letter only.
 *
 * Self-contained: no deps, no server data, no hooks. The component
 * matches the design-system tokens (`success / warning / danger / info /
 * accent / ink-500`) so the monograms read as part of the visual
 * language.
 */

export interface MonogramProps {
  nombre: string
  apellido: string
  /** Tailwind size class. Default `h-10 w-10`. */
  size?: string
  /** Additional className for the wrapping span. */
  className?: string
  /** Optional id used to build the `data-testid` (e.g. socio id). */
  id?: string
}

/**
 * Six-token palette mapped to existing design tokens so the monogram
 * visually rhymes with `StatusBadge` and the summary cards. The order
 * is deterministic — the hash picks an index, the index picks a token.
 */
const PALETTE = [
  'bg-success',
  'bg-warning',
  'bg-danger',
  'bg-info',
  'bg-accent',
  'bg-night-900',
] as const

/**
 * Strip Spanish/Portuguese-style accents + turn any char in the "keep
 * set" into uppercase. Used to derive initials from raw names so a
 * socio named "García" lands on `G`, not on the raw `í`.
 *
 * Uses `String.prototype.normalize('NFD')` to split accented chars
 * into base + combining mark, then drops the combining mark.
 */
function cleanChar(ch: string): string {
  // Normalize → drop combining diacritics → uppercase. If the result
  // is empty (e.g., a pure accent char), fall back to the original so
  // we never return an empty initial.
  const normalized = ch.normalize('NFD').replace(/\p{M}/gu, '')
  const upper = normalized.toLocaleUpperCase('es-AR')
  return upper || ch.toLocaleUpperCase('es-AR')
}

function pickInitial(s: string): string {
  for (const ch of s) {
    if (/\S/.test(ch)) return cleanChar(ch)
  }
  return ''
}

/**
 * djb2-style string hash → small non-negative integer. Sufficient for
 * distributing names across a 6-bucket palette without needing a
 * cryptographic hash; we only need stability across renders.
 */
function hashName(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return h
}

export function Monogram({ nombre, apellido, size = 'h-10 w-10', className, id }: MonogramProps) {
  const a = pickInitial(apellido)
  const n = pickInitial(nombre)
  const initials = `${a}${n}` || '?'
  const fullName = `${nombre} ${apellido}`.trim()
  const palette = PALETTE[hashName(fullName) % PALETTE.length] ?? PALETTE[0]
  const testId = `monogram-${id ?? 'anon'}`
  return (
    <span
      data-testid={testId}
      role="img"
      aria-label={fullName || 'Socio sin nombre'}
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold text-white tabular-nums select-none',
        size,
        palette,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {initials}
    </span>
  )
}
