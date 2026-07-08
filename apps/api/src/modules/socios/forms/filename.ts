/**
 * Build the PDF download filename for the `solicitud-inscripcion` form.
 *
 * Format: `solicitud-inscripcion-socio-{N}-{Apellido-sanitized}.pdf`.
 * The `apellido` is sanitized through `sanitizeApellido`:
 *   1. NFD-strip combining diacritics (`Pérez` → `Perez`)
 *   2. Replace every non-alphanumeric run with `_` (`O'Brien` → `O_Brien`)
 *   3. Trim leading/trailing `_`
 *   4. UPPERCASE
 *
 * This guarantees ASCII-only filenames for the `Content-Disposition`
 * header (RFC 6266 + browser tab-name safety) while keeping them
 * readable in the operator's Downloads folder.
 */

export interface FilenameSocio {
  numeroSocio: string | number
  apellido: string
}

export function buildFilename(socio: FilenameSocio): string {
  const num = String(socio.numeroSocio)
  const apellido = sanitizeApellido(socio.apellido)
  return `solicitud-inscripcion-socio-${num}-${apellido}.pdf`
}

export function sanitizeApellido(apellido: string): string {
  return apellido
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}
