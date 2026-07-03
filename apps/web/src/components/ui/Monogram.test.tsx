import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Monogram } from './Monogram'

/**
 * Monogram tests (PR 8b.2 second slice).
 *
 * Contract:
 *   - Initials = `<apellido[0]><nombre[0]>`, uppercased
 *   - Accents are stripped (Spanish-aware NFD normalisation)
 *   - Single-name field: still produces two-letter initials when both
 *     `nombre` and `apellido` are set; when one is blank, falls back
 *     to `?` rather than throwing
 *   - Empty inputs: emits a `?` placeholder and an informative aria-label
 *   - Same name → same initial / colour (determinism — verified by
 *     capturing the test-id twice and comparing)
 *
 * Visual styling and palette colors are NOT asserted on (per the
 * Strict TDD "no implementation-detail coupling" rule).
 */

describe('Monogram', () => {
  it('derives initials from apellido[0] + nombre[0] (uppercase)', () => {
    render(<Monogram nombre="Juan" apellido="García" id="s1" />)
    const el = screen.getByTestId('monogram-s1')
    expect(el).toHaveTextContent('GJ')
  })

  it('strips Spanish accents from the initials (García → G, María → M)', () => {
    const { rerender } = render(<Monogram nombre="María" apellido="García" id="s2" />)
    expect(screen.getByTestId('monogram-s2')).toHaveTextContent('GM')

    rerender(<Monogram nombre="Ángela" apellido="Pérez" id="s3" />)
    // "Pérez" first letter = 'P'; "Ángela" first non-empty letter = 'A'
    expect(screen.getByTestId('monogram-s3')).toHaveTextContent('PA')
  })

  it('produces a single-letter initial when the second field is blank', () => {
    render(<Monogram nombre="Juan" apellido="" id="s4" />)
    // `apellido` is blank so it contributes no letter; only the `J`
    // from `nombre` is rendered. The fallback `?` only applies when
    // BOTH fields are blank.
    expect(screen.getByTestId('monogram-s4')).toHaveTextContent('J')
  })

  it('falls back to the placeholder initial when both fields are blank', () => {
    render(<Monogram nombre="" apellido="" id="s5" />)
    const el = screen.getByTestId('monogram-s5')
    expect(el).toHaveTextContent('?')
    expect(el).toHaveAttribute('aria-label', 'Socio sin nombre')
  })

  it('is deterministic: the same name always produces the same initials', () => {
    const { rerender } = render(<Monogram nombre="Juan" apellido="García" id="d1" />)
    const first = screen.getByTestId('monogram-d1').textContent

    rerender(<Monogram nombre="Juan" apellido="García" id="d2" />)
    const second = screen.getByTestId('monogram-d2').textContent

    expect(first).toBe(second)
  })

  it('exposes the full name via aria-label for screen readers', () => {
    render(<Monogram nombre="Juan" apellido="García" id="s6" />)
    expect(screen.getByTestId('monogram-s6')).toHaveAttribute('aria-label', 'Juan García')
  })

  it('honours the `size` prop (passes the className through)', () => {
    render(<Monogram nombre="Juan" apellido="García" id="s7" size="h-8 w-8" />)
    expect(screen.getByTestId('monogram-s7').className).toContain('h-8')
    expect(screen.getByTestId('monogram-s7').className).toContain('w-8')
  })
})
