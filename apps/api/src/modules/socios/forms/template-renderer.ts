/**
 * Pure `{{var}}` template substitution with HTML escape.
 *
 * Designed for the `solicitud-inscripcion` HTML template: the template
 * is a single TS string constant with `{{var}}` placeholders. Each
 * placeholder is replaced by the escaped value of the matching key
 * in the `variables` record. Unknown placeholders become empty
 * strings (the empty-string substitution keeps the template valid
 * HTML even when a field is missing — e.g. NULL `fecha_nacimiento`
 * renders as `..../..../......` after the template author wrote the
 * dotted-line spans).
 *
 * Why a hand-rolled renderer (no Handlebars/Mustache):
 *   - The template has ~10 placeholders and zero logic (no loops,
 *     no conditionals). A full template engine is overkill.
 *   - HTML escape MUST happen at substitution time (not at template
 *     compile time) because the template author wrote the surrounding
 *     markup as raw HTML. Escape protects against a socio `nombre`
 *     like `<script>alert(1)</script>` rendering live JS in the PDF.
 *
 * Placeholder grammar:
 *   - Identifier: `[A-Za-z_][A-Za-z0-9_]*`
 *   - Whitespace inside the braces is tolerated (`{{ foo }}` works).
 *   - Unknown identifier → empty string.
 *
 * For templates that need to embed pre-rendered HTML chunks (e.g. the
 * `ctacte-comprobante` table rows + totals footer), pair this with
 * `renderTemplateMixed` — it accepts both escaped scalars AND raw
 * HTML chunks (via the `__raw:<name>` prefix convention), and runs
 * the raw substitution FIRST so the escaped scalar pass can't
 * double-encode the `<` / `>` of the chunk.
 */

export type TemplateVariableValue = string | number | null | undefined

export function renderTemplate(
  template: string,
  variables: Record<string, TemplateVariableValue>,
): string {
  return template.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_match, name: string) => {
    const raw = variables[name]
    if (raw === null || raw === undefined) return ''
    return escapeHtml(String(raw))
  })
}

/**
 * Mixed-mode renderer. Variables whose name starts with `__raw:` are
 * substituted RAW (no HTML escape); all others are escaped as in
 * `renderTemplate()`. The raw pass runs FIRST so a raw value can
 * contain `{{var}}`-looking text that gets processed by the scalar
 * pass.
 *
 * Use this for templates that embed pre-rendered HTML chunks (e.g.
 * the `ctacte-comprobante` movements table + totals footer).
 */
export function renderTemplateMixed(
  template: string,
  variables: Record<string, TemplateVariableValue>,
): string {
  // Pass 1 — raw substitution.
  let out = template.replace(
    /\{\{\s*__raw:([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_match, name: string) => {
      const raw = variables[name]
      if (raw === null || raw === undefined) return ''
      return String(raw)
    },
  )
  // Pass 2 — escaped scalar substitution.
  out = out.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_match, name: string) => {
    const raw = variables[name]
    if (raw === null || raw === undefined) return ''
    return escapeHtml(String(raw))
  })
  return out
}

/**
 * HTML-escape the 5 characters that have special meaning in HTML
 * text + quoted attributes. Designed to be safe inside both element
 * text and double-quoted attribute values.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
