'use client'

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Socio } from '@/lib/api/socios'
import {
  collectionButtonClass,
  collectionFieldClass,
  collectionInlineStatusClass,
} from './CollectionPrimitives'

type SocioOption = Pick<Socio, 'id' | 'nombre' | 'apellido' | 'numero_socio'>

type Props = {
  socios: SocioOption[]
  selectedSocio: SocioOption | null
  onSearch: (term: string) => Promise<void> | void
  onSelectSocio: (socio: SocioOption) => Promise<void> | void
}

export function DebtSearch({ socios, selectedSocio, onSearch, onSelectSocio }: Props) {
  const [term, setTerm] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchError, setSearchError] = useState('')
  const alertRef = useRef<HTMLParagraphElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const searchRequest = useRef(0)
  const message = searchError || (isSearching ? 'Buscando socios…' : '')

  useEffect(() => {
    if (searchError) alertRef.current?.focus()
  }, [searchError])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const request = ++searchRequest.current
    setIsSearching(true)
    setHasSearched(false)
    setSearchError('')
    try {
      await onSearch(term.trim())
      if (request === searchRequest.current) setHasSearched(true)
    } catch {
      if (request === searchRequest.current)
        setSearchError('No se pudo buscar socios. Intentá nuevamente.')
    } finally {
      if (request === searchRequest.current) setIsSearching(false)
    }
  }

  function moveResultFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!socios.length) return
    const target =
      event.key === 'ArrowDown'
        ? socios[Math.min(index + 1, socios.length - 1)]
        : event.key === 'ArrowUp'
          ? socios[Math.max(index - 1, 0)]
          : event.key === 'Home'
            ? socios[0]
            : event.key === 'End'
              ? socios.at(-1)
              : null
    if (event.key === 'Escape') {
      event.preventDefault()
      inputRef.current?.focus()
    } else if (target) {
      event.preventDefault()
      resultRefs.current[target.id]?.focus()
    }
  }

  return (
    <>
      <form
        role="search"
        aria-label="Buscar un socio para consultar su deuda"
        onSubmit={submit}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="min-w-0 flex-1 space-y-1 font-body text-sm font-medium text-ink-700">
          Buscar socio
          <input
            ref={inputRef}
            aria-label="Buscar socio"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className={collectionFieldClass}
          />
        </label>
        <button type="submit" className={collectionButtonClass.primary} disabled={isSearching}>
          {isSearching ? 'Buscando…' : 'Buscar socio'}
        </button>
      </form>
      {!isSearching && socios.length > 0 && (
        <ul
          aria-label="Resultados de búsqueda de socios"
          className="divide-y divide-ink-200 border border-ink-200"
        >
          {socios.map((option, index) => (
            <li key={option.id}>
              <button
                ref={(node) => {
                  resultRefs.current[option.id] = node
                }}
                type="button"
                onClick={() => void onSelectSocio(option)}
                onKeyDown={(event) => moveResultFocus(event, index)}
                className={`min-h-11 w-full px-3 py-2 text-left font-body text-sm text-ink-900 hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${selectedSocio?.id === option.id ? 'bg-info-soft font-semibold' : ''}`}
              >
                <span className="block">
                  {option.apellido}, {option.nombre}
                </span>
                <span className="block font-mono text-xs text-ink-700">
                  N.° {option.numero_socio}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p
          ref={alertRef}
          role={searchError ? 'alert' : 'status'}
          aria-live={searchError ? 'assertive' : 'polite'}
          tabIndex={searchError ? -1 : undefined}
          className={collectionInlineStatusClass(searchError ? 'error' : 'neutral')}
        >
          {message}
        </p>
      )}
      {hasSearched && !isSearching && !searchError && socios.length === 0 && (
        <p role="status" className={collectionInlineStatusClass('neutral')}>
          No se encontraron socios. Probá buscar con otro nombre.
        </p>
      )}
    </>
  )
}
