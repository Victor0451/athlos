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
