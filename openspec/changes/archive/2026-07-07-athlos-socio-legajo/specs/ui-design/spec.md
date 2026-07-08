# Delta for `ui-design`

This delta updates the Socio Detail page tab list to add the new `Legajo` tab, matching the layout patterns already established for the existing tabs (`Datos`, `Contacto`, `Cuenta`, `Auditoría`).

## ADDED Requirements

### Requirement: Legajo Tab on `/socios/[id]`

The Socio Detail page (`/socios/[id]`) SHALL render a `Legajo` tab in the existing tab list, ordered after `Auditoría`. The tab uses the underline-style pattern defined elsewhere in this spec:

- Inactive: `ink-500` text, no bottom border.
- Active: 2 px `accent` bottom border, `ink-900` text.
- Leading icon: Lucide `FolderOpen`, 16 px, color follows the tab's active/inactive text token.
- Label: "Legajo" in `label` (12 px / 1.4 / +0.02em / 600 / uppercase).

When the tab is active, the panel body SHALL render `<LegajoTab socioId={id} />` which composes three sub-components:

1. `<AttachmentUploadZone>` — a drag-and-drop drop zone + a click-to-pick `<input type="file" multiple={false} accept="image/jpeg,image/png,image/webp,image/gif,application/pdf">`. Drag-over visuals: `border-accent bg-accent-soft`. Client-side validation rejects oversized/disallowed files BEFORE calling the API and surfaces an inline error message ("Archivo excede 10 MB" / "Tipo de archivo no permitido").
2. `<AttachmentGrid>` — a grid of cards. Each card shows: image thumbnail (image MIMEs via `<img src=".../file">`) OR a Lucide `FileText` icon + download link (PDFs — no thumbnail in v1); the original filename; a category badge (`dni | comprobante | foto | contrato | otro`); uploader + upload timestamp; size in KB or MB.
3. `<AttachmentPreviewModal>` — a `<Modal>` (sticky header / scroll body / sticky footer) that renders the image inline (`<img>`) for image MIMEs OR a download `<a download>` link for PDFs.

Empty state (no active attachments): escudo icon (96 px) + "Sin archivos" h3 + "Subí un DNI, comprobante o foto para empezar" body-sm. Matches the precedent set by other empty tabs in this spec.

Delete flow: clicking the trash icon on a card opens a destructive `<Modal>` with the standard confirm pattern. On confirm, the row disappears from the grid; toast feedback fires via the existing `notify()` wrapper (`success` / `error`, per the `athlos-toast-primitivo` change).

#### Scenario: Legajo tab appears in the tab list

- **WHEN** the Socio Detail page renders
- **THEN** a tab labeled "Legajo" with a `FolderOpen` leading icon SHALL be visible in the tab list
- **AND** it SHALL appear after the "Auditoría" tab

#### Scenario: Active Legajo panel renders the tab body

- **WHEN** the operator clicks the Legajo tab
- **THEN** the panel under the tab SHALL render `<LegajoTab socioId={id} />`
- **AND** the active tab indicator SHALL switch to that tab

#### Scenario: Empty state renders shield + copy

- **WHEN** the operator opens the Legajo tab for a socio with no active attachments
- **THEN** an empty state SHALL render with the escudo icon, a "Sin archivos" h3, and the body-sm description
- **AND** the drop zone SHALL still be visible above the empty state so the operator can drop without scrolling

#### Scenario: Drop zone appears with hover affordance

- **WHEN** the operator drags a file over the drop zone
- **THEN** the zone SHALL switch to `border-accent bg-accent-soft`
- **AND** the system SHALL fire `dragover` preventDefault to allow the drop

#### Scenario: Image card shows thumbnail

- **WHEN** the grid renders an active image attachment (jpeg/png/webp/gif)
- **THEN** the card SHALL include an `<img>` whose `src` is the `/file` endpoint
- **AND** the image SHALL load successfully while authenticated

#### Scenario: PDF card shows FileText icon and download link

- **WHEN** the grid renders an active PDF attachment
- **THEN** the card SHALL show a Lucide `FileText` icon and the original filename
- **AND** SHALL include a download `<a href=".../file" download>` link
- **AND** SHALL NOT render an `<img>` thumbnail

#### Scenario: Click on image card opens preview modal

- **WHEN** the operator clicks an image attachment card
- **THEN** an `<AttachmentPreviewModal>` SHALL open
- **AND** the modal body SHALL render the image at full size
- **AND** the modal close button SHALL dismiss the preview

#### Scenario: Click on PDF card opens preview modal with download link

- **WHEN** the operator clicks a PDF attachment card
- **THEN** an `<AttachmentPreviewModal>` SHALL open
- **AND** the modal body SHALL contain a download `<a download>` link with the original filename

#### Scenario: Delete confirmation opens destructive modal

- **WHEN** the operator clicks the trash icon on an attachment card
- **THEN** a confirm `<Modal>` SHALL open with a destructive primary button labeled "Eliminar"
- **AND** on confirm, the `DELETE` API call SHALL fire

#### Scenario: Successful upload shows success toast

- **WHEN** a successful upload resolves
- **THEN** `notify('success', 'Archivo subido')` SHALL fire
- **AND** the new card SHALL appear at the top of the grid

#### Scenario: Oversize file shows inline error and does NOT call the API

- **WHEN** the operator drops a 12 MB file onto the drop zone
- **THEN** the API SHALL NOT be called
- **AND** an inline error message ("Archivo excede 10 MB") SHALL display
- **AND** NO toast SHALL fire (inline errors are the canonical feedback for client-side validation)

#### Scenario: Disallowed MIME shows inline error and does NOT call the API

- **WHEN** the operator drops a `.txt` file onto the drop zone
- **THEN** the API SHALL NOT be called
- **AND** an inline error message ("Tipo de archivo no permitido") SHALL display
