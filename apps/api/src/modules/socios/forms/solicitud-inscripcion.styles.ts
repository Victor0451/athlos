/**
 * CSS for the `solicitud-inscripcion` PDF.
 *
 * A4 portrait, 25mm vertical + 30mm horizontal margins (per design §5).
 * The two `.rect-*` floating rectangles (`rect-acta`, `rect-socio`)
 * live at the pinned coordinates 50mm from the top, one on each side,
 * 60mm × 8mm each — they are visual separators from the source .docx,
 * not data-bearing fields. All other layout is plain flow.
 *
 * The `font-family` is `Times New Roman` because the source .docx
 * uses the same serif. The `printBackground: true` puppeteer option
 * (set in `pdf-generator.ts`) preserves the `header` border + the
 * FESCAG `border-top` across the rendered PDF.
 */

export const SOLICITUD_INSCRIPCION_STYLES = `
@page {
  size: A4;
  margin: 25mm 30mm;
}

* { box-sizing: border-box; }

body {
  font-family: 'Times New Roman', Times, serif;
  font-size: 11pt;
  line-height: 1.3;
  color: #000;
  margin: 0;
}

.club-header {
  text-align: center;
  border-bottom: 1px solid #000;
  padding-bottom: 6mm;
  margin-bottom: 8mm;
  position: relative;
}

.club-logo {
  float: left;
  width: 25mm;
  height: 25mm;
  margin-right: 4mm;
  margin-top: -2mm;
}

.club-name {
  font-weight: bold;
  font-size: 13pt;
  margin: 0 0 1mm 0;
  letter-spacing: 0.5pt;
}

.club-data {
  font-size: 8pt;
  margin: 1mm 0 0 0;
  line-height: 1.25;
}

.header-date {
  text-align: right;
  margin-top: 4mm;
  font-size: 10pt;
}

.numero-fields {
  display: flex;
  justify-content: space-between;
  margin: 4mm 0 6mm 0;
  font-weight: bold;
  font-size: 11pt;
}

.field-block {
  display: inline-block;
}

.dotted-line {
  display: inline-block;
  min-width: 50mm;
  border-bottom: 1px dotted #000;
  text-align: center;
  padding: 0 2mm;
}

.intro {
  margin: 4mm 0;
  text-align: justify;
}

.identificacion {
  margin: 3mm 0;
  text-align: justify;
}

.declaracion {
  margin: 2mm 0;
  text-align: justify;
}

.domicilio-block {
  margin: 3mm 0;
}

.domicilio-line {
  display: flex;
  gap: 4mm;
  margin: 1.5mm 0;
  font-size: 10pt;
}

.domicilio-line .label {
  font-weight: bold;
  min-width: 18mm;
}

.otros-block {
  margin: 3mm 0;
  font-size: 10pt;
}

.otros-line {
  margin: 1mm 0;
}

.fescag-section {
  margin-top: 12mm;
  padding-top: 4mm;
  border-top: 1px solid #000;
  font-size: 9pt;
  text-align: justify;
}

.fescag-section h2 {
  font-size: 10pt;
  font-weight: bold;
  text-align: center;
  margin: 0 0 2mm 0;
}

.fescag-section h3 {
  font-size: 9pt;
  font-weight: bold;
  text-align: center;
  margin: 2mm 0 1mm 0;
}

.fescag-section .article {
  margin: 1.5mm 0;
}

.rect-acta,
.rect-socio {
  position: absolute;
  border: 1px solid #000;
  background: transparent;
}

.rect-acta {
  top: 50mm;
  right: 30mm;
  width: 60mm;
  height: 8mm;
}

.rect-socio {
  top: 50mm;
  left: 30mm;
  width: 60mm;
  height: 8mm;
}

.signature-line {
  display: flex;
  justify-content: space-between;
  margin: 12mm 0 2mm 0;
}

.signature-line .sig {
  border-top: 1px solid #000;
  padding-top: 1mm;
  width: 60mm;
  text-align: center;
  font-size: 9pt;
}
`
