# Design: Socios Legacy Identity Foundation

## Technical Approach

Add an isolated identity aggregate in the existing `socios` PostgreSQL schema. The first slice contains only Drizzle declarations, one transactional migration, and PostgreSQL integration tests; `socios.socios`, `tesoreria.ctacte`, API DTOs, and `@athlos/import` remain authoritative and untouched. Later promotion code may populate the aggregate from `raw_events`, but legacy evidence never determines identity by itself.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|---|---|---|
| Separate account, person, membership, holder-history, and evidence tables | Extend flat `socios.socios` | Preserves compatibility and separates immutable identity from responsibility and legacy evidence. |
| Independent PostgreSQL identity sequences for account/member numbers | `MAX+1`; application counters | Atomic sequence allocation is concurrency-safe; gaps are accepted, uniqueness is enforced independently. |
| Partial unique index plus deferred constraint triggers | Application-only validation | A unique current holder survives races; commit-time checks allow atomic account creation/transfer while enforcing one current holder for every validated account and no overlapping effective periods. |
| Link evidence to append-only `raw_events` | Copy all payload fields | `raw_events.payload`, source key, hash, and batch already provide immutable lineage; the identity table adds classification without duplicating sensitive data. |
| Stage compatibility instead of dual-writing | Rewrite Socio/CTACTE now | Existing UUID FKs and all consumers remain valid. A later adapter may resolve an explicit reviewed link; no inferred link or ownership change occurs here. |

## Data Model and Flow

`membership_accounts(id UUID, account_number bigint identity UNIQUE, lifecycle_state, timestamps)` owns `account_memberships(account_id, member_id, effective_from, effective_to)`. `member_identities(id UUID default gen_random_uuid(), member_number bigint identity UNIQUE, lifecycle_state, credential_ref text NULL UNIQUE, timestamps)` provides person identity; `credential_ref` is opaque and stores no token, biometric, scan, or delivery data.

`account_holder_history` references an account membership, records effective bounds, predecessor assignment, `actor_operator_id` or system `source`, evidence JSON, and optional unique idempotency key. A composite FK proves the holder belongs to the account. `legacy_identity_evidence` references one unique `raw_event_id`, repeats only queryable lineage (`source_key`, `import_batch`, `SOCCARNET`, `SOCFAMILIA`, anomaly codes, review state), permits nullable account/member links, and deliberately uses a non-unique legacy-pair index.

    raw_events -> evidence(imported/review_required) -> human validation -> account/member
                                                               |
    authorized transfer -> lock account -> close holder -> open holder -> audit_events

Ambiguous, duplicate, or incomplete pairs create separate `review_required` evidence rows with no inferred member, account, or holder. Resolution is a later ADMIN-only command that records reviewer, reason, and audit event; it never mutates raw evidence.

## Requirement and Transaction Mapping

| Scenario | Mechanism / proof |
|---|---|
| Distinct identities | UUID PKs plus two independent sequence-backed unique numbers. |
| Number collision | Database allocation and unique indexes; conflicting writes fail atomically, never substitute values. |
| Transfer responsibility | Future service transaction uses `SELECT ... FOR UPDATE`, closes the old range, inserts successor and `audit_events`; route must authenticate and require `ADMIN`. |
| Reject overlap | Partial unique current-holder index and deferred overlap trigger preserve prior history on failure. |
| Unambiguous import | Unique `raw_event_id` makes retries no-ops; state remains `imported` until an audited validation transaction. |
| Duplicate/ambiguous import | Non-unique pair index, anomaly codes, nullable links, and `review_required`; no merge or holder assignment. |
| Preserve references | No changes to Socio, CTACTE, importer, promotion, API, or web contracts. |
| Invalid write | One DB transaction rolls back account, member, membership, holder, evidence, and audit rows together. |

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/db/src/schema/socios.ts` | Modify | Add enums, five tables, indexes, and inferred types. |
| `packages/db/src/schema/index.ts` | Modify | Export additive schema contracts. |
| `packages/db/drizzle/0037_socios_legacy_identity.sql` | Create | Transactional DDL, sequences, FKs, indexes, and deferred triggers. |
| `packages/db/src/schema/socios-identity.test.ts` | Create | Disposable-PostgreSQL migration and invariant tests. |

## Testing Strategy

PostgreSQL integration tests cover all eight scenarios, including parallel number allocation, concurrent current-holder attempts, deferred validation, retrying one raw event, duplicate legacy pairs, full transaction rollback, migration re-application, and unchanged Socio/CTACTE FKs. Logs assert aggregate counts/error codes only—never names, DNI, keys, pairs, or payloads. No E2E test is needed because no route changes.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary changes.

## Migration / Rollout

`0037` runs inside `BEGIN/COMMIT`, creates only additive objects, emits non-sensitive counts, and is safe to retry with guarded DDL. Deploy before any producer. Rollback is a forward-fix migration that drops/disables only these objects after proving them unconsumed. Keep the first slice below 400 changed lines by deferring repositories, API commands, promotion, backfill, and adapters.

## Open Questions

None blocking; transfer and evidence-resolution endpoints require their own later specification.
