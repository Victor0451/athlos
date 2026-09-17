'use client'

import { useState } from 'react'
import { searchEligibleAccounts, type AccountChartItem } from '@/lib/api/account-chart'

interface EligibleAccountPickerProps {
  selected: AccountChartItem | null
  onSelect: (account: AccountChartItem) => void
  disabled?: boolean
}

/** Searches active imputable leaves and lets the caller pick exactly one eligible account. */
export function EligibleAccountPicker({
  selected,
  onSelect,
  disabled,
}: EligibleAccountPickerProps) {
  const [query, setQuery] = useState('')
  const [accounts, setAccounts] = useState<AccountChartItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  const search = async () => {
    setSearching(true)
    setError('')
    try {
      setAccounts(await searchEligibleAccounts(query))
    } catch {
      setAccounts(null)
      setError('No se pudo buscar la cuenta.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <label>
          Buscar cuenta
          <input
            className="mt-1 block w-full rounded border p-2"
            value={query}
            disabled={disabled || searching}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="mt-auto rounded border px-3 py-2"
          disabled={disabled || searching}
          onClick={() => void search()}
        >
          {searching ? 'Buscando…' : 'Buscar cuenta'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {accounts !== null && accounts.length === 0 && (
        <p role="status">Sin cuentas elegibles para la búsqueda.</p>
      )}
      {accounts !== null && accounts.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-sm">Cuenta imputable</legend>
          {accounts.map((account) => (
            <label key={account.code} className="block">
              <input
                type="radio"
                name="movement-account"
                checked={selected?.code === account.code}
                onChange={() => onSelect(account)}
                disabled={disabled}
              />
              {account.code} — {account.name}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}
