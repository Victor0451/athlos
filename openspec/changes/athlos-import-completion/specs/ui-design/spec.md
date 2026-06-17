# Delta for ui-design

> Source: Decision 5 (confirm-and-wait modal with 30s cancel window for `POST /api/v1/import/trigger`). **Full UI implementation is deferred to PR 8** — this delta declares the contract so the legacy-import spec can reference it and the PR 8 task plan can stub against it.

## ADDED Requirements

### Requirement: Confirm-and-Wait Import Modal

The Import Status page (`/import`) MUST surface a "Nueva importación" primary action that opens a confirm modal before calling `POST /api/v1/import/trigger`. The modal MUST be styled per the existing Modal token (`shadow-lg`, `radius-lg`, fade + 4px slide-down entrance, 300ms).

The modal content MUST include:
- A short headline (verb-first, infinitive, e.g., "Importar 14 tablas")
- A one-line body explaining expected duration (e.g., "Esta operación puede tardar ~5 minutos")
- A visible countdown (30s → 0s) on the primary action label ("Importar ahora (30s)")
- Footer: secondary "Cancelar" (closes the modal, no request) + primary "Importar ahora" (decrementing countdown)

The countdown is purely client-side. The server's cancel window is enforced independently (see legacy-import delta).
(Decision 5: friendlier UX than fire-and-forget. Operator sees expected scope, has a clear cancel path, and gets immediate feedback via the countdown.)

#### Scenario: Admin opens the modal and confirms within 30s

- GIVEN admin is on `/import` and clicks "Nueva importación"
- WHEN the modal opens
- THEN the primary button label MUST show "Importar ahora (30s)"
- AND the count MUST decrement once per second

- WHEN the admin clicks "Importar ahora" at second 12 (countdown shows "18s")
- THEN the client MUST call `POST /api/v1/import/trigger` with `{ domain: "all" }`
- AND the response MUST be 202 with `{ batchId: "<uuid>" }`
- AND the modal MUST close
- AND the page MUST show an active import banner with the returned `batchId`

#### Scenario: Admin cancels

- GIVEN the modal is open with countdown at 22s
- WHEN the admin clicks "Cancelar"
- THEN the modal MUST close
- AND NO request to `/api/v1/import/trigger` MUST be made
- AND no job MUST be enqueued

#### Scenario: Countdown reaches 0 without click

- GIVEN the modal is open and the countdown reaches 0
- WHEN 30 seconds elapse without user interaction
- THEN the modal MUST close automatically
- AND no request MUST be sent
- AND the same behavior as "Cancelar" applies

#### Scenario: Error response from trigger

- GIVEN the admin clicks "Importar ahora" and the server returns 500 (e.g., legacy DB unreachable)
- WHEN the client receives the error
- THEN the modal MUST display an error banner inside the modal panel (not a toast — modal context is preserved)
- AND the "Cancelar" + "Importar ahora" buttons MUST remain enabled so the admin can retry

### Requirement: Trigger Button Honors RBAC

The "Nueva importación" primary action on the Import Status page MUST be visible only to operators with role `ADMIN`. Operators without `ADMIN` MUST see the page (read-only) without the primary action.
(From TASK-060: the import trigger is admin-only; the UI MUST hide the affordance, not just 403 on click.)

#### Scenario: Admin sees the trigger

- GIVEN an operator with role `ADMIN` opens `/import`
- WHEN the page renders
- THEN the "Nueva importación" primary button MUST be visible in the page header (right-aligned per the existing page-header pattern)

#### Scenario: Non-admin does not see the trigger

- GIVEN an operator with role `OPERATOR` opens `/import`
- WHEN the page renders
- THEN the "Nueva importación" button MUST NOT be rendered
- AND the rest of the page (history table, dependency graph) MUST remain readable
