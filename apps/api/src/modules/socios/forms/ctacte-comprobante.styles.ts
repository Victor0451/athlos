/**
 * CSS for the `ctacte-comprobante` PDF (PR A1b.2 — athlos-ctacte-mutations).
 *
 * A4 portrait, 20mm vertical + 18mm horizontal margins. The Gorriti
 * Premium header at the top carries the club logo + name + the
 * "COMPROBANTE DE CUENTA CORRIENTE" subtitle. The socio card is a
 * 4-cell grid (SOCIO N°, TITULAR, DNI, PERIODO) separated by dashed
 * dividers in line with the canonical UI tokens.
 *
 * The `font-family` is `Helvetica` / `Arial` — the comprobante is a
 * structured business document (numeric tabular data) so a sans-serif
 * reads better than the Times serif used for the solicitud-inscripcion
 * form. The printBackground: true puppeteer option (set in
 * `pdf-generator.ts`) preserves the table borders + the club-header
 * border across the rendered PDF.
 *
 * `print-color-adjust: exact` ensures the dashed dividers survive the
 * PDF print pipeline (default would drop them as "decorative" color
 * backgrounds).
 */

export const CTACTE_COMPROBANTE_STYLES = `
@page {
  size: A4;
  margin: 20mm 18mm;
}

* { box-sizing: border-box; }

body {
  font-family: 'Helvetica', 'Arial', sans-serif;
  font-size: 10pt;
  line-height: 1.35;
  color: #000;
  margin: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.club-header {
  text-align: left;
  border-bottom: 2px solid #000;
  padding-bottom: 4mm;
  margin-bottom: 6mm;
  position: relative;
  display: flex;
  align-items: center;
  gap: 4mm;
}

.club-logo {
  width: 22mm;
  height: 22mm;
  flex-shrink: 0;
}

.club-name-block { flex: 1; }

.club-name {
  font-weight: bold;
  font-size: 12pt;
  margin: 0 0 1mm 0;
  letter-spacing: 0.5pt;
}

.doc-title {
  font-size: 9pt;
  font-weight: bold;
  margin: 0;
  letter-spacing: 1pt;
  text-transform: uppercase;
}

.socio-card {
  display: grid;
  grid-template-columns: 1fr 2fr 1fr 2fr;
  gap: 0;
  border: 1px solid #000;
  margin-bottom: 6mm;
  font-size: 10pt;
}

.socio-card .cell {
  padding: 2mm 3mm;
  border-right: 1px dashed #888;
}

.socio-card .cell:last-child { border-right: none; }

.socio-card .cell .label {
  display: block;
  font-size: 7pt;
  font-weight: bold;
  letter-spacing: 0.5pt;
  text-transform: uppercase;
  color: #555;
  margin-bottom: 1mm;
}

.socio-card .cell .value {
  font-size: 10pt;
  font-weight: bold;
}

.movements-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 6mm;
  font-size: 9pt;
}

.movements-table thead th {
  background: #f0f0f0;
  border: 1px solid #000;
  padding: 2mm 2mm;
  text-align: left;
  font-size: 8pt;
  font-weight: bold;
  letter-spacing: 0.5pt;
  text-transform: uppercase;
}

.movements-table thead th.num { text-align: right; }

.movements-table tbody td {
  border-left: 1px solid #888;
  border-right: 1px solid #888;
  padding: 1.5mm 2mm;
  vertical-align: top;
}

.movements-table tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }

.movements-table tbody tr:last-child td {
  border-bottom: 1px solid #000;
}

.movements-table tfoot td {
  background: #f0f0f0;
  border: 1px solid #000;
  padding: 2mm;
  font-weight: bold;
  font-size: 9pt;
  text-transform: uppercase;
  letter-spacing: 0.5pt;
}

.movements-table tfoot td.num { text-align: right; font-variant-numeric: tabular-nums; }

.doc-footer {
  margin-top: 8mm;
  padding-top: 4mm;
  border-top: 1px dashed #888;
  font-size: 8pt;
  text-align: center;
  color: #555;
}

.doc-footer p { margin: 1mm 0; }
`
