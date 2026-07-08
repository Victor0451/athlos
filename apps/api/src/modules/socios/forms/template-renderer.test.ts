import { describe, expect, it } from 'vitest'
import { escapeHtml, renderTemplate } from './template-renderer.ts'

/**
 * `renderTemplate` + `escapeHtml` — pure substitution + HTML escape.
 *
 * Locks the contract used by `emit-form.ts` to inject the titular
 * data into the `solicitud-inscripcion` HTML template. Every token
 * gets HTML-escaped (defence-in-depth against an `apellido` of
 * `<script>...</script>`); missing variables resolve to empty
 * strings (the template renders dotted-line spans around them so a
 * blank value still looks correct visually).
 */

describe('renderTemplate', () => {
  it('substitutes a single placeholder', () => {
    expect(renderTemplate('Hola {{name}}', { name: 'Juan' })).toBe('Hola Juan')
  })

  it('substitutes multiple placeholders', () => {
    expect(renderTemplate('{{greeting}}, {{name}}!', { greeting: 'Hola', name: 'Juan' })).toBe(
      'Hola, Juan!',
    )
  })

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{ foo }} {{  bar  }}', { foo: 'a', bar: 'b' })).toBe('a b')
  })

  it('substitutes numeric values', () => {
    expect(renderTemplate('Socio {{numero}}', { numero: 12345 })).toBe('Socio 12345')
  })

  it('HTML-escapes the 5 special characters in a value', () => {
    const raw = `<script>alert("xss & 'a'")</script>`
    const out = renderTemplate('{{x}}', { x: raw })
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('&quot;')
    expect(out).toContain('&#39;')
    expect(out).toContain('&amp;')
  })

  it('renders empty string for null or undefined variables', () => {
    expect(renderTemplate('{{a}}-{{b}}', { a: null, b: undefined })).toBe('-')
  })

  it('renders empty string for unknown identifiers', () => {
    expect(renderTemplate('{{known}}-{{unknown}}', { known: 'x' })).toBe('x-')
  })

  it('is idempotent when no placeholders are present', () => {
    const template = '<p>Static HTML</p>'
    expect(renderTemplate(template, { x: 1 })).toBe(template)
  })

  it('does not substitute malformed placeholders', () => {
    // The grammar is `[A-Za-z_][A-Za-z0-9_]*` — numbers and dashes
    // are left as literal text so a typo in the template shows up
    // visibly in the rendered PDF.
    expect(renderTemplate('{{ 1bad }} {{with-dash}}', {})).toBe('{{ 1bad }} {{with-dash}}')
  })

  it('leaves no unsubstituted tokens when every variable is provided', () => {
    const template = '<p>{{a}}-{{b}}-{{c}}</p>'
    const rendered = renderTemplate(template, { a: 'x', b: 'y', c: 'z' })
    expect(rendered).not.toMatch(/\{\{/)
    expect(rendered).toBe('<p>x-y-z</p>')
  })
})

describe('escapeHtml', () => {
  it('escapes the 5 special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })

  it('passes plain text through unchanged', () => {
    expect(escapeHtml('Pérez García')).toBe('Pérez García')
  })
})
