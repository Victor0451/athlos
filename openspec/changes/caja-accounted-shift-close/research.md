# Research complete: external supporting-document recording

```json
{
  "schema": "gentle-ai.sdd-research/v1",
  "revision": 3,
  "change": "caja-accounted-shift-close",
  "outcome": "complete",
  "artifact_store": "openspec",
  "skill_resolution": "paths-injected",
  "exploration_reference": "exploration.md",
  "request": {
    "origin": "Orchestrator-retained documentation research",
    "selected_classes": ["documentation"],
    "unselected_classes": ["open-web"],
    "allowed_publishers": ["ARCA", "AFIP"],
    "purpose": "Record metadata from externally issued Argentine supporting documents in Athlos Caja",
    "exclusions": ["fiscal issuance", "integration", "automatic tax or withholding calculation", "legal certification", "automated fiscal validation"]
  },
  "questions": [
    "Which official document types and letters may be presented as metadata choices for already-issued documents?",
    "How do official materials describe external credit/debit-note references?",
    "Which number, point-of-sale, issuer-identification, recipient-identification, and tax-breakdown fields can be supported for transcription?",
    "How should external documents be distinguished from internal unnumbered records without presenting the latter as fiscal invoice substitutes?",
    "Which time/version changes affect letter M?"
  ],
  "admission": {
    "outcome": "complete",
    "observed_exact_grants": {"documentation": ["orchestrator-supplied official ARCA/AFIP retrieval"], "open-web": []},
    "selected_class_completion": {"documentation": "complete for recording-only scope"},
    "historical_child_local_result": {
      "outcome": "unavailable",
      "basis": "The prior child-local runtime did not expose fetch_content; it produced no source retrieval or validation."
    },
    "basis": "The orchestrator independently retrieved the official sources below. This closes the selected research only for recording/transcription design; it does not establish universal fiscal rules or product-side fiscal validation."
  },
  "evidence_calls": [
    {
      "tool": "fetch_content",
      "arguments": {"urls": ["https://www.arca.gob.ar/facturacion/comprobantes/tipos.asp", "https://www.arca.gob.ar/facturacion/regimen-general/comprobantes.asp"]},
      "response_id": "mu0glw7vddbbtr",
      "retrieved_by": "orchestrator",
      "retrieval_time": "2026-09-13T23:43:00Z (approximate)"
    },
    {
      "tool": "get_search_content",
      "arguments": {"responseId": "mu0glw7vddbbtr", "urlIndex": 0},
      "result": "full content retrieved for S1 URL",
      "retrieved_by": "orchestrator",
      "retrieval_time": "2026-09-13T23:43:00Z (approximate)"
    },
    {
      "tool": "get_search_content",
      "arguments": {"responseId": "mu0glw7vddbbtr", "urlIndex": 1},
      "result": "full content retrieved for S2 URL",
      "retrieved_by": "orchestrator",
      "retrieval_time": "2026-09-13T23:43:00Z (approximate)"
    },
    {
      "tool": "fetch_content",
      "arguments": {"urls": ["https://biblioteca.afip.gob.ar/dcp/REAG01001415_2003_01_07", "https://biblioteca.arca.gob.ar/search/query/norma.aspx?p=t%3ARAG%7Cn%3A5614%7Co%3A9%7Ca%3A2024%7Cf%3A12%2F12%2F2024"]},
      "response_id": "mu0h0bmyzlzire",
      "retrieved_by": "orchestrator",
      "retrieval_time": "2026-09-13 (UTC; exact retrieval time not recorded)"
    },
    {
      "tool": "get_search_content",
      "arguments": {"responseId": "mu0h0bmyzlzire", "urlIndex": 1, "findText": ["IVA Contenido", "importe", "5614"]},
      "result": "RG 5614 content retrieved",
      "retrieved_by": "orchestrator",
      "retrieval_time": "2026-09-13 (UTC; exact retrieval time not recorded)"
    },
    {
      "tool": "fetch_content",
      "arguments": {"url": "https://servicioscf.afip.gob.ar/publico/comprobantes/cae.aspx", "mode": "raw"},
      "response_id": "mu0h0vm2bwl1d0",
      "result": "visible form content retrieved; no submission, query, CAPTCHA, or authentication performed",
      "retrieved_by": "orchestrator",
      "retrieval_time": "2026-09-13 (UTC; exact retrieval time not recorded)"
    },
    {
      "tool": "fetch_content",
      "arguments": {"urls": ["https://www.arca.gob.ar/fe/emision-autorizacion/datos-comprobantes.asp"]},
      "incomplete_call_provenance": "The actual call also included an ARCA QR PDF URL, but that URL was not retained in this artifact and is omitted rather than reconstructed.",
      "response_id": "mu0gz7gzqjmup3",
      "retrieved_by": "orchestrator",
      "retrieval_time": "2026-09-13 (UTC; exact retrieval time not recorded)"
    },
    {
      "tool": "get_search_content",
      "arguments": {"responseId": "mu0gz7gzqjmup3", "urlIndex": 0},
      "result": "full page content retrieved",
      "retrieved_by": "orchestrator",
      "retrieval_time": "2026-09-13 (UTC; exact retrieval time not recorded)"
    }
  ],
  "sources": [
    {
      "id": "S1",
      "publisher": "ARCA",
      "url": "https://www.arca.gob.ar/facturacion/comprobantes/tipos.asp",
      "title": "Tipos de comprobantes",
      "publisher_version": null,
      "retrieved_at": "2026-09-13T23:43:00Z (approximate)",
      "excerpts": [
        "Facturas, tiques y tiques factura",
        "Recibos emitidos por profesionales universitarios y demás prestadores de servicios",
        "Las notas de crédito y débito siempre que se encuentren relacionadas a una o más facturas o documentos equivalentes emitidos previamente",
        "Remitos, guías o documentos equivalentes",
        "Recibos, comprobantes que respalda el pago, total o parcial, de una operación que debe ser documentada mediante la emisión de facturas."
      ],
      "notes": "The page refers to Anexo II de la Resolución General N° 1415/2003. No page revision was shown in retrieved evidence."
    },
    {
      "id": "S2",
      "publisher": "ARCA",
      "url": "https://www.arca.gob.ar/facturacion/regimen-general/comprobantes.asp",
      "title": "Comprobantes — régimen general",
      "publisher_version": "RG 5762, effective 2025-12-01",
      "retrieved_at": "2026-09-13T23:43:00Z (approximate)",
      "excerpts": [
        "Mediante la RG 5762 (que entró en vigencia el 1 de diciembre de 2025) se abrogó la Resolución General 1575",
        "Operación sujeta a retención",
        "Pago en CBU informada"
      ],
      "notes": "Paraphrase/abbreviated transcription: the retrieved content described continuity with progressivity and correlativity for each class-M document code before 1 December 2025. The retrieved table maps the former M cases to A and describes historical M-code continuity."
    },
    {
      "id": "S3",
      "publisher": "ARCA",
      "url": "https://biblioteca.arca.gob.ar/search/query/norma.aspx?p=t%3ARAG%7Cn%3A5614%7Co%3A9%7Ca%3A2024%7Cf%3A12%2F12%2F2024",
      "title": "Resolución General 5614/2024",
      "publisher_version": "Emitted 2024-12-12; Boletín Oficial 2024-12-13; Vigente",
      "retrieved_at": "2026-09-13 (UTC; exact retrieval time not recorded)",
      "excerpts": [
        "En el caso de operaciones gravadas efectuadas con sujetos responsables inscriptos en el gravamen o adheridos al Régimen Simplificado para Pequeños Contribuyentes (Monotributo), deberá discriminarse:",
        "1.1. La alícuota a que está sujeta la operación.",
        "1.2. El monto del impuesto resultante.",
        "1.3. El monto de los restantes tributos que no integren el precio neto gravado.",
        "1.4. El importe de la percepción que resulte procedente.",
        "De tratarse de operaciones gravadas efectuadas con sujetos exentos, no alcanzados o consumidores finales frente al impuesto al valor agregado deberá discriminarse el impuesto que recae sobre la operación.",
        "IVA Contenido",
        "Otros Impuestos Nacionales Indirectos"
      ],
      "notes": "This evidence supports transcription/display context. It does not authorize Athlos to calculate, infer, or validate tax treatment."
    },
    {
      "id": "S4",
      "publisher": "ARCA (page titled AFIP)",
      "url": "https://servicioscf.afip.gob.ar/publico/comprobantes/cae.aspx",
      "title": "AFIP — comprobantes CAE consultation form",
      "publisher_version": null,
      "retrieved_at": "2026-09-13 (UTC; exact retrieval time not recorded)",
      "excerpts": [
        "Número de CUIT:",
        "Fecha de Emisión del Comprobante",
        "Tipo de Comprobante",
        "Punto de Venta - Número de Comprobante:",
        "Importe Total de la operación en la moneda original del comprobante",
        "Factura M / A con Leyenda Operación Sujeta a Retención"
      ],
      "notes": "Paraphrase/observation: options 52/53 are analogous Nota de Crédito/Nota de Débito M / A with the retention legend. Observed form controls: p_CUIT has title '11 dígitos' and maxlength 11; p_pto_vta has maxlength 5 and numeric-only behavior; p_nro_cbte has maxlength 8 and numeric-only behavior. This is observation of one official consultation form, not a universal legal validation rule, uniqueness rule, or mandate for every internal receipt or imported document."
    },
    {
      "id": "S5",
      "publisher": "ARCA",
      "url": "https://www.arca.gob.ar/fe/emision-autorizacion/datos-comprobantes.asp",
      "title": "Datos de los comprobantes",
      "publisher_version": null,
      "retrieved_at": "2026-09-13 (UTC; exact retrieval time not recorded)",
      "excerpts": [
        "Los comprobantes deberán contener los datos establecidos en el Anexo II de la Resolución General N° 1415/2003."
      ],
      "notes": "Paraphrase/interpretation: the retrieved page supports that recipient identification is distinct from issuer identification. It does not supply a recipient threshold rule for this product."
    }
  ],
  "validated_claims": [
    {
      "claim": "The product may capture the printed external document type, letter, and legend as metadata for an already-issued document.",
      "sources": ["S1", "S2", "S4"],
      "scope": "Recording/management only; not issuance or fiscal validation."
    },
    {
      "claim": "An externally issued credit or debit note must reference one or more previously issued invoices or equivalent documents.",
      "sources": ["S1"]
    },
    {
      "claim": "For external-document transcription, retain issuer identity together with document type and the printed point-of-sale and document-number components as text, preserving leading zeros. The S4 control lengths are form-observation metadata, not universal validation or legal uniqueness constraints.",
      "sources": ["S4"]
    },
    {
      "claim": "The product may transcribe the external document's original-currency total, issue date, recipient identity when printed, and tax labels/amounts that appear on it; it must not infer a recipient rule or tax treatment from these sources.",
      "sources": ["S3", "S4", "S5"],
      "scope": "Recording/management only."
    },
    {
      "claim": "A printed 'IVA Contenido' or 'Otros Impuestos Nacionales Indirectos' amount is informational contained-tax transcription already represented in the gross total; it must not be added to the gross total again or require a fabricated net amount.",
      "sources": ["S3"],
      "scope": "Product interpretation for recording; not a new tax computation."
    },
    {
      "claim": "Remitos, guides, equivalent documents, and payment receipts listed by S1 as non-valid invoice substitutes must not be represented as invoice substitutes. They may still be retained as internal supporting evidence when product policy allows.",
      "sources": ["S1"],
      "scope": "The internal-evidence conclusion is a product interpretation, not an ARCA validation of those records."
    },
    {
      "claim": "Letter M is historical continuity metadata after 2025-12-01, not a current-emission recommendation; the product must retain historical M records without recommending M issuance or implementing retentions.",
      "sources": ["S2"]
    }
  ],
  "unvalidated_or_outstanding": [
    "Any universal legal numbering, point-of-sale, issuer/recipient, or document-identity rule beyond the bounded S4/S5 observations",
    "Any recipient-identification threshold rule",
    "Any fiscal rule for automatic calculation, withholding, issuance, enforcement, CAE consultation, or product-side fiscal validation",
    "The body of the historical PDF linked from the ARCA web-service help page; it was unavailable and is not the basis for any claim"
  ],
  "evidence_metadata": {
    "publisher_versions": ["S1: no page revision shown", "S2: RG 5762 effective 2025-12-01", "S3: RG 5614 emitted 2024-12-12, BO 2024-12-13, vigente", "S4: no version/date shown", "S5: no version/date shown"],
    "discovery_only": [
      "Official-domain web searches were used only to discover URLs; snippets were not admitted as evidence.",
      "site:arca.gob.ar comprobantes numeración cinco ocho dígitos IVA neto gravado transparencia fiscal",
      "site:servicioscf.afip.gob.ar numeración cinco ocho comprobantes"
    ],
    "failed_sources_not_used": [
      "https://www.arca.gob.ar/facturacion/comprobantes.asp (404)",
      "https://www.arca.gob.ar/facturacion/comprobantes/ and /regimen-general/ (readable extraction failed because of HTML meta redirect)",
      "https://www.arca.gob.ar/facturacion/documentos/puntos-de-venta.pdf (89-character unusable body)",
      "https://biblioteca.afip.gob.ar/dcp/REAG01001415_2003_01_07 (response too large: 5 MB)",
      "ARCA web-service help page linked a manual 4.7 PDF, but its body was unavailable"
    ]
  },
  "proposal_ready": true,
  "next_action": "Prepare proposal artifacts for approval using these bounded recording-only claims; do not implement before approval."
}
```
