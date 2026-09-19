import { apiFetch } from '@/lib/api'

export interface AccountChartItem {
  code: string
  name: string
  parent: { code: string; name: string } | null
  root: { code: string; name: string }
  path: Array<{ code: string; name: string }>
  active: boolean
  imputable: boolean
  eligible: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRef = (value: unknown): value is { code: string; name: string } =>
  isRecord(value) && typeof value.code === 'string' && typeof value.name === 'string'

const decodeItem = (value: unknown): AccountChartItem | null => {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    typeof value.name !== 'string' ||
    (value.parent !== null && !isRef(value.parent)) ||
    !isRef(value.root) ||
    !Array.isArray(value.path) ||
    !value.path.every(isRef) ||
    typeof value.active !== 'boolean' ||
    typeof value.imputable !== 'boolean' ||
    typeof value.eligible !== 'boolean'
  )
    return null
  return {
    code: value.code,
    name: value.name,
    parent: value.parent,
    root: value.root,
    path: value.path,
    active: value.active,
    imputable: value.imputable,
    eligible: value.eligible,
  }
}

/**
 * Fetches every active account and keeps only eligible imputable leaves, deduplicated by
 * code. The combobox renders the full list with client-side filtering (erpgw-style dropdown),
 * so it needs the whole catalog once instead of per-keystroke server searches.
 */
export async function fetchAllEligibleAccounts(): Promise<AccountChartItem[]> {
  const value = await apiFetch<unknown>('/api/v1/account-chart?active=true')
  if (!isRecord(value) || !Array.isArray(value.items))
    throw new Error('Account chart response was incomplete')
  const items: AccountChartItem[] = []
  const seen = new Set<string>()
  for (const raw of value.items) {
    const item = decodeItem(raw)
    if (!item) throw new Error('Account chart response was incomplete')
    // A duplicated code would break selection identity (two rows for one account), so the
    // first occurrence wins and later rows with the same code are dropped.
    if (item.eligible && !seen.has(item.code)) {
      seen.add(item.code)
      items.push(item)
    }
  }
  return items
}

/** Diacritics-insensitive lowercase needle, matching the server-side search semantics. */
export const normalizedAccount = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
