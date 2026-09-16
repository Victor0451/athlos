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

// Eligible accounts are active imputable leaves; the API filters active server-side and the
// eligibility flag decides selection, so group/inactive rows never reach the manual form.
export async function searchEligibleAccounts(name: string): Promise<AccountChartItem[]> {
  const query = name.trim()
  if (!query) return []
  const value = await apiFetch<unknown>(
    '/api/v1/account-chart?name=' + encodeURIComponent(query) + '&active=true',
  )
  if (!isRecord(value) || !Array.isArray(value.items))
    throw new Error('Account chart response was incomplete')
  const items: AccountChartItem[] = []
  for (const raw of value.items) {
    const item = decodeItem(raw)
    if (!item) throw new Error('Account chart response was incomplete')
    if (item.eligible) items.push(item)
  }
  return items
}
