import { TemplateNotFoundError } from '../types.ts'

/**
 * The single placeholder pattern. Matches `{{ varName }}` with
 * optional surrounding whitespace; the captured group is the
 * variable name. No nested expressions, no helpers — the spec
 * mandates plain interpolation.
 */
const PLACEHOLDER = /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g

/**
 * Render a template string by substituting `{{var}}` placeholders
 * with values from the context. The renderer is deliberately
 * strict: a missing variable throws `TemplateNotFoundError`
 * (caught by the dispatcher; the event is logged to audit as a
 * failure). The regex is the entire implementation — no parser,
 * no AST, no template engine.
 *
 * Values are coerced via `String(v)`. Date, number, boolean, and
 * string all render as expected; objects and arrays render as
 * `[object Object]` / `1,2,3` (callers MUST pass scalars).
 */
export function render(
  template: string,
  ctx: Record<string, string | number | boolean | Date>,
): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    if (!(key in ctx)) {
      throw new TemplateNotFoundError(`Missing template variable: ${key}`)
    }
    const v = ctx[key]
    if (v === undefined || v === null) {
      throw new TemplateNotFoundError(`Missing template variable: ${key}`)
    }
    return String(v)
  })
}
