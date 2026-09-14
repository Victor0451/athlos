# Pre-proposal ready: accounted shift close

```json
{
  "schema": "gentle-ai.sdd-preproposal/v1",
  "revision": 4,
  "change": "caja-accounted-shift-close",
  "exploration_reference": "exploration.md",
  "research_reference": "research.md",
  "research_request": {
    "origin": "Orchestrator-retained documentation research",
    "classes": ["documentation"],
    "allowed_publishers": ["ARCA", "AFIP"],
    "purpose": "Metadata recording and management of externally issued Argentine supporting documents only",
    "completed_evidence": [
      "Official ARCA catalog evidence for document types/letters and NC/ND linkage",
      "Official ARCA evidence that M is historical continuity metadata after RG 5762 effective 2025-12-01",
      "Official RG 5614 evidence for printed tax-disclosure labels, including IVA Contenido and Otros Impuestos Nacionales Indirectos",
      "Bounded official consultation-form observation for CUIT, issue date, document type, point-of-sale/document-number, original-currency total, and M/A retention-legend selections",
      "Official ARCA page evidence that recipient identification is distinct from issuer identification"
    ],
    "limitations": [
      "S4 is a bounded official form observation, not a universal legal numbering, formatting, uniqueness, or validation rule.",
      "No recipient-identification threshold rule was established.",
      "The historical ARCA web-service-help manual 4.7 PDF body was unavailable and supports no claim.",
      "The RG 1415 source body was too large to retrieve; no claim treats it as fully read."
    ],
    "excluded": ["open-web research", "fiscal issuance", "integration", "automatic tax/withholding calculations", "legal certification", "automated fiscal validation"]
  },
  "admission": {
    "outcome": "complete",
    "selected_class_completion": {"documentation": "complete for recording-only scope"},
    "basis": "The orchestrator supplied bounded official ARCA/AFIP evidence sufficient for a recording-only proposal. It does not authorize or require fiscal validation."
  },
  "evidence_references": [
    "research.md#S1 — ARCA Tipos de comprobantes",
    "research.md#S2 — ARCA Comprobantes — régimen general",
    "research.md#S3 — ARCA Resolución General 5614/2024",
    "research.md#S4 — ARCA/AFIP comprobantes CAE consultation form",
    "research.md#S5 — ARCA Datos de los comprobantes"
  ],
  "validated_claims": [
    "Capture printed external-document metadata only for already-issued documents; do not issue, validate, or integrate fiscal documents.",
    "Store point-of-sale and document-number components as text and preserve leading zeros; observed controls do not establish universal legal rules.",
    "Require an external NC/ND to reference a prior invoice or equivalent document.",
    "Permit transcription of printed tax labels and amounts without automatic tax calculation or validation.",
    "Treat IVA Contenido and Otros Impuestos Nacionales Indirectos as informational amounts already contained in the gross total.",
    "Do not present remitos, guides, equivalent documents, or payment receipts as invoice substitutes; product policy may retain them as internal supporting evidence.",
    "Retain historical M records without recommending current M issuance or implementing retentions."
  ],
  "product_decisions": {
    "status": "confirmed refinements; proposal/design approval remains pending",
    "authority": "User confirmations relayed by orchestrator; non-authoritative as external documentary evidence",
    "confirmed": [
      "Boxes are personal per operator and may be concurrent; an operator with a prior open box cannot open the next one.",
      "Payments are full only; OPERADOR Caja also has Collections access.",
      "All daily production from the operator's shift is automatic income, shown with source links and broken down by CASH, DEBIT, CREDIT, and TRANSFER; distinct manual income remains available.",
      "Every manual income and every manual expense requires exactly one payment method; a movement is paid in full by that one method.",
      "CASH, DEBIT, CREDIT, and TRANSFER are distinct payment methods. A DEBIT card receipt is not a BANK_DEBIT expense; BANK_DEBIT is an approved non-cash expense concept and must not imply bank-ledger integration.",
      "Expected cash is computed server-side as opening CASH plus CASH income minus CASH expenses. Non-cash expenses never reduce physical cash; opening and production must not double count.",
      "The close operator action is sufficient. There is no separate editable declared-handoff amount, custody declaration, or treasurer approval requirement.",
      "Existing physical count, variance, and reason safeguards remain independent reconciliation controls; they do not set or alter the computed closing transfer amount.",
      "A positive computed cash balance creates exactly one Valores a Depositar outflow for that computed amount; zero creates none; negative blocks close without an override.",
      "No automatic carryover occurs from a previous unclosed box; preserve existing expired-shift recovery.",
      "External documents record their references and issuer; internal documents are unnumbered.",
      "Optional additive tax-breakdown transcription may be validated by requiring its sum to equal the document total; a mismatch blocks saving.",
      "Informational contained-tax transcription is not additive and neither requires a fictitious net amount nor is added to the gross total again.",
      "Every movement is an account-linked accounting source record, not full double-entry general-ledger accounting.",
      "Cuotas sociales is approved under 4.1 Ingresos Operativos and dues production binds to it. Other production origins must not silently use that account."
    ]
  },
  "proposal_ready": true,
  "authorization": "Research and planning-artifact refinement are authorized; no implementation until artifacts are approved.",
  "delivery": {
    "strategy": "ask-on-risk",
    "review_budget_changed_lines": 400,
    "chain_strategy": "deferred",
    "size_exception_approved": false
  },
  "next_action": "Review and approve the revised proposal/design; do not create tasks or implement before approval."
}
```

## Factual learnings

1. The selected official-source research is complete only for recording/transcription design, not for fiscal validation or universal tax rules.
2. The official CAE consultation form observes CUIT, date, type, point-of-sale/document-number, and original-currency-total fields; its observed lengths do not establish universal product rules.
3. RG 5614 supports recording printed tax-disclosure labels, while contained-tax amounts must remain informational and not be added to the gross total twice.
4. Recipient identification is separate from issuer identification in the retrieved ARCA material, but no recipient threshold rule was established.
5. The unavailable historical PDF and unread full RG 1415 body remain explicit evidence limitations.
