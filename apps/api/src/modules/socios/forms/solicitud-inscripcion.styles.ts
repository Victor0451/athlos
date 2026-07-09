/**
 * CSS for the `solicitud-inscripcion` PDF.
 *
 * A4 portrait, 25mm vertical + 30mm horizontal margins (per design section 5).
 *
 * **2026-07-09 chore (papurri):** full rewrite of styles to match the
 * structure in `/srv/docs/transcripcion_gorriti.md`. New styles
 * cover:
 *   - Floating textboxes for `SOCIO Nº` and `ACTA Nº` (anchored
 *     top-right of the page, overlapping the header).
 *   - Table T1 — Datos del solicitante (5+ cols × multiple rows, with
 *     row-spanning for column 0 labels like "DOMICILIO\nPARTICULAR"
 *     and "OTROS").
 *   - Table T2 — Grupo Familiar (5 cols × 9 empty rows + header).
 *   - Tables T3, T4 — small tables in Ficha del Jugador.
 *   - Signature grid (4 cols on Section 1, 2 cols on Sections 3-4).
 *   - Section headings (h1, h2, h3) — centered, large.
 *   - Dotted-line spans rendered as inline-blocks with bottom
 *     border (more realistic than literal `.....` characters).
 *   - Subitems a/b/c in Article 2 of FESCAG.
 *
 * The 2 floating rectangles (`rect-acta`, `rect-socio`) from the
 * previous version were removed (2026-07-09 chore): they were visual
 * separators from the source .docx but were misaligned at PDF render
 * time and not data-bearing. Per operator feedback, dropped them.
 *
 * The `font-family` is `Times New Roman` because the source .docx
 * uses it. The form is meant to look like a printed paper form
 * from a Word document.
 *
 * Spacing strategy:
 *   - Headings (h1, h2, h3) centered, large, with explicit margins.
 *   - Section spacing 6-8mm to visually delimit the 4 sections.
 *   - Dotted line spans: `display: inline-block; min-width: 60mm;
 *     border-bottom: 1px dotted #000;` — looks like a real form
 *     line, not a string of dots.
 *   - Page breaks: A4 with the natural content flow; explicit
 *     `page-break-before: always` on the FESCAG section so it
 *     starts on its own page (matches the operator's mental model
 *     from the source .docx).
 */

export const SOLICITUD_INSCRIPCION_STYLES = `@page {
  size: A4;
  margin: 25mm 30mm;
}

* {
  box-sizing: border-box;
}

body {
  font-family: 'Times New Roman', serif;
  font-size: 10pt;
  line-height: 1.35;
  color: #000;
  margin: 0;
  padding: 0;
}

/* --- Club header --- */

.club-header {
  text-align: center;
  border-bottom: 2px solid #000;
  padding-bottom: 3mm;
  margin-bottom: 6mm;
  position: relative;
}

.club-logo {
  width: 28mm;
  height: auto;
  display: block;
  float: left;
  margin: 0 4mm 3mm 0;
  object-fit: contain;
}

.club-name {
  font-weight: bold;
  font-size: 13pt;
  margin: 0;
  letter-spacing: 0.5pt;
  /* Center the title around the logo's top half */
  padding-top: 6mm;
}

.club-data {
  font-size: 8pt;
  margin: 1mm 0 0 0;
  line-height: 1.25;
  text-align: left;
}

/* --- Textboxes row (SOCIO Nº + ACTA Nº, stacked, full width) --- */

.textboxes-row {
  display: flex;
  flex-direction: column;
  gap: 1mm;
  width: 55mm;
  margin: 0 0 4mm auto;
}

.floating-numero,
.floating-acta {
  font-size: 9pt;
  border: 1px solid #000;
  padding: 1mm 2mm;
  background: #fff;
  box-sizing: border-box;
}

.floating-numero {
  margin-bottom: 1mm;
}

/* --- Header date --- */

.header-date {
  text-align: right;
  margin: 4mm 0 3mm 0;
  font-size: 9pt;
}

/* --- Destinatario line (legacy styles — kept for backward compat) --- */

.destinatario strong {
  font-weight: bold;
}

/* --- SU / DESPACHO subheading --- */

.subheading {
  text-align: center;
  font-weight: bold;
  font-size: 10pt;
  margin: 3mm 0 2mm 0;
  letter-spacing: 1pt;
}

/* --- Body paragraphs --- */

.intro,
.identificacion,
.declaracion {
  text-align: justify;
  margin: 1.5mm 0;
}

.identificacion {
  margin-bottom: 3mm;
}

/* --- Dotted line spans (form fields) --- */

.dotted {
  display: inline-block;
  min-width: 40mm;
  border-bottom: 1px dotted #000;
  padding: 0 2mm;
  vertical-align: baseline;
  min-height: 4mm;
}

.dotted-small {
  display: inline-block;
  min-width: 20mm;
  border-bottom: 1px dotted #000;
  padding: 0 1mm;
  vertical-align: baseline;
}

/* --- Table T1 — Datos del solicitante --- */

.tabla-t1 {
  width: 100%;
  border-collapse: collapse;
  margin: 3mm 0;
  font-size: 9pt;
}

.tabla-t1 td {
  border: 1px solid #000;
  padding: 1.5mm 2mm;
  vertical-align: middle;
}

.tabla-t1 .label-cell {
  background: #f0f0f0;
  font-weight: normal;
  white-space: nowrap;
  text-align: left;
}

.tabla-t1 .dotted-cell {
  min-width: 30mm;
}

.tabla-t1 .checkbox-cell {
  text-align: center;
  width: 20mm;
}

/* --- Table T2 — Grupo Familiar --- */

.caption {
  font-size: 10pt;
  font-weight: bold;
  text-align: center;
  margin: 4mm 0 1mm 0;
  text-transform: uppercase;
}

.tabla-t2 {
  width: 100%;
  border-collapse: collapse;
  margin: 1mm 0 3mm 0;
  font-size: 9pt;
}

.tabla-t2 thead {
  background: #d9d9d9;
}

.tabla-t2 th,
.tabla-t2 td {
  border: 1px solid #000;
  padding: 2mm;
  text-align: left;
  vertical-align: bottom;
}

.tabla-t2 th {
  font-weight: bold;
  text-align: center;
}

.tabla-t2 td {
  height: 7mm;
}

/* --- Padre/madre authorization --- */

.autorizacion {
  text-align: justify;
  margin: 1.5mm 0;
  line-height: 1.6;
}

/* --- Signature grids --- */

.signature-grid {
  display: grid;
  gap: 4mm;
  margin: 6mm 0 2mm 0;
}

.signature-grid:not(.signature-grid-2) {
  grid-template-columns: repeat(4, 1fr);
}

.signature-grid-2 {
  grid-template-columns: repeat(2, 1fr);
}

.sig-col {
  display: flex;
  flex-direction: column;
}

.sig-line {
  border-top: 1px solid #000;
  height: 6mm;
}

.sig-label {
  font-size: 8pt;
  text-align: center;
  margin-top: 1mm;
}

.sig-num {
  font-size: 7pt;
  text-align: center;
  margin-top: 1mm;
}

/* --- FESCAG section --- */

.fescag-section {
  margin-top: 6mm;
  padding-top: 4mm;
  border-top: 1px solid #000;
  font-size: 9pt;
  text-align: justify;
  page-break-before: always;
}

.section-title {
  font-size: 12pt;
  font-weight: bold;
  text-align: center;
  margin: 0 0 1mm 0;
  letter-spacing: 0.5pt;
}

.section-subtitle {
  font-size: 10pt;
  font-weight: bold;
  text-align: center;
  margin: 0 0 4mm 0;
  letter-spacing: 0.5pt;
}

.fescag-section .article {
  margin: 2mm 0;
  text-align: justify;
}

.fescag-section .subitem {
  margin: 0.5mm 0 0.5mm 5mm;
}

/* --- Acta de Conformidad --- */

.acta-section {
  margin-top: 6mm;
  padding-top: 4mm;
  border-top: 1px solid #000;
  page-break-before: always;
}

/* --- Ficha del Jugador --- */

.ficha-section {
  margin-top: 6mm;
  padding-top: 4mm;
  border-top: 1px solid #000;
  page-break-before: always;
}

.tabla-t3 {
  width: 100%;
  border-collapse: collapse;
  margin: 2mm 0;
  font-size: 9pt;
}

.tabla-t3 th,
.tabla-t3 td {
  border: 1px solid #000;
  padding: 2mm;
  text-align: center;
}

.tabla-t3 th {
  background: #f0f0f0;
  font-weight: bold;
}

.tabla-t3 .empty-cell {
  height: 8mm;
}`
