# Archive Report — athlos-import-completion

## Change Closure

**Change**: athlos-import-completion
**Archived at**: 2026-06-18
**Status**: ✅ Archived (sdd-verify PASS at commit 7cd47f4)
**Final version**: 0.3.0
**Commit**: 7cd47f4 Merge pull request #4 from Victor0451/fix/7b.2-verify-critical-issues

---

## Delivery Summary

### PRs Merged (4 total)

| PR | Label | Version bump | Notes |
|----|-------|-------------|-------|
| #1 | 7b.1a | 0.1.0 → 0.1.0 | lineage + projection + migrations 0007/0008/0009 |
| #2 | 7b.1b | 0.2.0 | drift + freshness + reconciliation job body swap |
| #3 | 7b.2 | 0.3.0 | routes + audit + permissions |
| #4 | verify fix | — | Critical issue resolution (DATA_STEWARD routing + CHANGELOG link) |

### Commits
- 4 merge commits (7b.1a → 7b.1b → 7b.2 → fix)
- N work-unit commits across the 4 PRs

### Tests
- Pre-change baseline: 322 passing
- Post-change: 439 passing
- **Delta: +117 new tests**

### Migrations (5 total)
| File | Description |
|------|-------------|
| 0007_entity_uuids | Composite PK `(source_table, source_key)`, unique `entity_uuid` |
| 0008_drift_snapshots | PK = `entity_uuid`, `last_hash`, `last_event_id` |
| 0009_domain_freshness | PK = `domain`, `last_import_at`, `record_count` |
| 0010_role_permissions | Composite PK `(operator_id, permission_key)`, FK → operators |
| 0011_audit_idempotency_partial_index | Partial unique index on `idempotency_key WHERE idempotency_key IS NOT NULL` |

### New Packages (5 total)
- `@athlos/lineage` — queryLineage, verifyHash
- `@athlos/projection` — rebuildProjection (idempotent), computeSaldo
- `@athlos/drift` — detect, emitDriftAlert (direct audit write)
- `@athlos/freshness` — getFreshness, DOMAIN_THRESHOLDS
- `@athlos/audit` — auditPlugin (fp-wrapped), emitAudit (SHA-256 10s bucket), queryAudit

---

## Specs Delivered (8 total)

All 8 delta specs have been synced to `openspec/specs/{domain}/spec.md`.

| Spec | Domain | Delta summary |
|------|--------|---------------|
| lineage-tracker | lineage | UUID `entity_id` as stable identifier; 5-field `LineageResponse`; `verifyHash` returns `{match, stored_hash, recomputed_hash, verified_at}` |
| projection-engine | projection | `DOMAIN_PROJECTION_TABLE` (11 domains); `rebuildProjection` idempotent (truncate-then-replay); `computeSaldo` returns `{debe, haber, saldo, as_of}` |
| drift-detector | drift | `IS DISTINCT FROM` detection; direct `audit_events` write (operator_id: null); `DATA_STEWARD` fanout |
| freshness-monitor | freshness | `DOMAIN_THRESHOLDS` hard-coded (11 domains); `ageToStatus`; Spanish `ageDisplay`; `CONFIG_MISSING` on missing threshold |
| audit-logger | audit | `fp`-wrapped `auditPlugin`; SHA-256 10s bucket idempotency; `queryAudit` pagination |
| legacy-import | legacy-import | UUID generation at import; `POST /import/trigger` (202 + batchId); `DELETE /import/trigger/:batchId` cancel semantics |
| notifications | notifications | `drift_alert` routes to `DATA_STEWARD` via `role_permissions`, not ADMIN |
| ui-design | ui-design | Confirm-and-wait modal (30s countdown); RBAC on trigger button (ADMIN only) |

---

## Decisions Taken (7 total)

Decisions #21–27 in `obsidian/0-Decisions.md`:

| # | Decision | Choice |
|---|----------|--------|
| 21 | Drift alert routing | DATA_STEWARD via `role_permissions` table |
| 22 | Freshness thresholds | Hard-coded in `packages/freshness/src/thresholds.ts` |
| 23 | Audit retention | Indefinite, no purge job |
| 24 | Lineage entityId shape | UUID generated at import, reused on re-import |
| 25 | Import UI | Confirm-and-wait modal with 30s cancel |
| 26 | DATA_STEWARD mechanism | `role_permissions(operator_id, permission_key)` table |
| 27 | Server-side cancel | `DELETE /import/trigger/:batchId` while `status='queued'` |

---

## Post-Archive Follow-ups (intentionally in flight)

| Follow-up | Change | Depends on | PR |
|-----------|--------|------------|-----|
| UI work | `athlos-ui` | This change (7b.2 API contracts landed) | PR 8a/b/c |
| Deployment | `athlos-deploy` | Independent | PR 9 |
| E2E tests | `athlos-e2e` | `athlos-ui` | PR 10b |

---

## Archive Contents

```
openspec/changes/athlos-import-completion/archive/2026-06-18/
├── proposal-snapshot.md   — original proposal
├── design-snapshot.md     — full technical design
├── tasks-snapshot.md      — 32/32 tasks (all checked)
├── verify-report.md       — sdd-verify PASS at 7cd47f4
└── archive-report.md      — this file
```

---

## Active Change Directory After Archive

After cleanup, the active change directory retains:
- `.openspec.yaml` (updated to `status: archived`)
- `archive/2026-06-18/` (snapshots + this report)

Removed from active artifacts:
- `proposal.md` → archived
- `design.md` → archived
- `tasks.md` → archived
- `specs/` → synced to main specs
- `verify-report.md` → archived

---

## SDD Cycle Complete

The change `athlos-import-completion` has been fully planned (proposal), specified (8 delta specs), designed (design.md), implemented (32 tasks across 3 PR slices), verified (439/439 tests PASS, typecheck clean, lint clean), and archived.

The following specs now reflect the new behavior:
- `openspec/specs/lineage-tracker/spec.md`
- `openspec/specs/projection-engine/spec.md`
- `openspec/specs/drift-detector/spec.md`
- `openspec/specs/freshness-monitor/spec.md`
- `openspec/specs/audit-logger/spec.md`
- `openspec/specs/legacy-import/spec.md`
- `openspec/specs/notifications/spec.md`
- `openspec/specs/ui-design/spec.md`

Ready for next change.
