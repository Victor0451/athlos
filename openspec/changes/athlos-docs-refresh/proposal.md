# Proposal: athlos-docs-refresh

- **Change name:** `athlos-docs-refresh`
- **Date:** 2026-06-18
- **Phase:** proposal
- **Mode:** both (Engram + OpenSpec filesystem)
- **Status:** proposed
- **Branch base:** `origin/main`
- **Delivery:** single PR, expected <400 changed lines
- **Target version bump:** v0.3.1 → v0.4.0 (minor; user-visible doc refresh), applied at PR close per project convention

---

## Intent

The code repo and Obsidian vault are at **v0.3.1** (shipped — foundation + import-completion archived), but the user-facing entry points still describe an earlier state. A new contributor reading `README.md` would believe Next 15 is current, Drizzle is "coming in PR 2", and the `packages/` directory is mostly empty — none of which is true. The Obsidian MOC entry points (`0-Index.md`, `0-README.md`, `3-Tech-Stack/0-Stack.md`, `7-Roadmap/0-Roadmap.md`) carry the same drift, and `5-Modules/0-Inventory.md` lists 9 product modules with no map to the 16 shipped internal packages. OpenSpec `specs/` has two undocumented migrations (`validation-zod` → `validation` rename; `user-management-rbac` folded into `auth-login`).

This change is a **doc-only / hygiene pass** that brings every user-facing doc to v0.3.1 truth and adds the missing module↔package map, with no code, schema, API, or dependency changes.

It unblocks: (1) a clean handoff for new contributors, (2) a defensible base before starting the next follow-up change (`athlos-deploy`, `athlos-ui`, or `athlos-e2e`), and (3) the v0.4.0 release note in `CHANGELOG.md`.

---

## Scope

### In Scope

**Code repo (`/run/media/vlongo/Archivos/Projectos/Athlos/`):**

| Path | Change | Justification |
|---|---|---|
| `README.md` | Rewrite top section: title, prereqs, layout, stack, tests, bilingual EN+ES | Currently says Next 15, "Drizzle lands in PR 2", packages "coming in PR 2+" — wrong on every line. Bilingual EN+ES sections per user decision. |
| `CHANGELOG.md` | Add `[0.4.0]` entry at PR close (NOT during) | Per project convention, CHANGELOG edits happen at close only. Entry documents the doc refresh. |
| `package.json` (root) | Bump `version` to `0.4.0` at PR close | Version bump on close per project convention. No bump during the PR. |
| `apps/*/package.json` | Only if they declare a top-level `version` field | Most likely not needed (apps are private workspace members); verify during apply. |

**Obsidian vault (external to repo, paths are vault-relative):**

| Path | Change | Justification |
|---|---|---|
| `0-Index.md` | Flip `athlos-import-completion` from "en curso" to "archivado el 2026-06-18"; add the 4 import-completion specs (`audit-logger`, `drift-detector`, `freshness-monitor`, `lineage-tracker`, `projection-engine` — 5 names, 4 were missing from index) | MOC still says work is in-flight 1 day after archive. |
| `0-README.md` | Update `Estado` to "v0.3.1 shipped"; replace tech-stack table with the real versions (Next 16.2.9, Fastify 5, Postgres 16, Node 22, 16 packages) or remove and point to `2-Architecture/0-Decisions.md` | Worst-stale doc in the vault: Next 14, Fastify 4, Node 20, Postgres 15+, "Planning" state. |
| `3-Tech-Stack/0-Stack.md` | Replace version block with a pointer to `2-Architecture/0-Decisions.md` (authoritative), or fix versions | Stale versions; `0-Decisions.md` is already correct. |
| `7-Roadmap/0-Roadmap.md` | Flip 7b.1a, 7b.1b, 7b.2 from ⏳/pending to ✅; add v0.3.1 hotfix note | All three slices merged; status table is 1 day behind. |
| `5-Modules/8-Module-Package-Map.md` | **NEW** — single table mapping 9 product modules (Padrón, Cuenta Corriente, Cuota Social, Disciplinas, Escuela, Contabilidad, Tesorería, Reportes, Auth y Roles) ↔ 16 internal packages + 4 integration adapters; flag unimplemented modules as "not yet started" | Most consequential gap: no map exists; future sdd-* sub-agents cannot tell whether "Cuota Social" is a separate module to build or a screen inside `ctacte`. |

**OpenSpec (`openspec/`):**

| Path | Change | Justification |
|---|---|---|
| `openspec/specs/RENAMED-validation.md` | **NEW** — short note documenting the `validation-zod/` → `validation/` rename; point readers to `validation/spec.md` | Safer than moving the folder (which would break any external links / archive paths). Already done in root, just undocumented. |
| `openspec/specs/auth-login/FOLDED-rbac.md` | **NEW** — note at top of `auth-login/` documenting that RBAC content was absorbed from the old `user-management-rbac/` spec; link to the foundation snapshot for the pre-merge version | `user-management-rbac/` was removed from root `specs/` but the absorption is invisible to future readers. |

### Out of Scope

- **No code changes.** No runtime, no schema, no API, no tests.
- **No dependency upgrades.** Stack versions stay exactly where they are.
- **No CI drift-check workflow.** A guard that fails the build when doc versions go stale is **deferred** (would need a new `.github/workflows/` file and a way to grep-check versions in `README.md` / `0-Stack.md`).
- **No new functionality.** `athlos-ui`, `athlos-deploy`, and `athlos-e2e` are follow-up changes — out of scope here, even though they appear in `7-Roadmap/0-Roadmap.md`.
- **No bulk Obsidian cleanup.** `2-Architecture/3-Gaps-Analysis.md` has a duplicate-row inconsistency (PR 3a/3b appears twice with conflicting status). Out of scope — small standalone fix, not part of this refresh.
- **No OpenSpec archive folder reshuffling.** The `validation-zod/` rename and `user-management-rbac/` removal are documented in place, not retroactively rewritten into the `athlos-foundation` archive.
- **No version bump during the PR.** Per project convention, `package.json` and `CHANGELOG.md` are touched only at PR close.

---

## Approach

Execute as a **single linear PR** in this order so each step is reviewable in isolation:

1. **README refresh first** (highest blast radius — every new contributor reads it). Bilingual EN+ES with a clear section order: `# Athlos` → EN section → `## Versión en Español` → common dev section → Stack. Use the **real** numbers from `package.json` (v0.3.1 → v0.4.0 at close), `apps/web/package.json` (Next 16.2.9), `apps/api/package.json` (Fastify 5), `packages/db` migrations.
2. **Obsidian entry points in one pass.** Update `0-Index.md`, `0-README.md`, `3-Tech-Stack/0-Stack.md`, `7-Roadmap/0-Roadmap.md` in that order. Each edit is small and reviewable.
3. **Module-Package map.** New file `5-Modules/8-Module-Package-Map.md`. Build the table from the foundation `5-Modules/0-Inventory.md` (product side) and `packages/*` + `packages/integrations/*` (code side). Mark the 6 product modules that have no code yet as "not yet started — covered by `athlos-ui` / `athlos-deploy` follow-up".
4. **OpenSpec hygiene.** Add `openspec/specs/RENAMED-validation.md` and `openspec/specs/auth-login/FOLDED-rbac.md` as 1-paragraph notes each. No file moves.
5. **Open the PR.** Title: `docs: refresh to v0.4.0 — README, Obsidian entry points, module map, OpenSpec hygiene`. Description summarizes the 5 buckets above and links to this proposal.
6. **PR close (separate commit on merge).** Bump root `package.json` to `0.4.0`; prepend `[0.4.0]` entry to `CHANGELOG.md`; merge.

---

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `README.md` | Modified | Rewrite to v0.3.1 truth; bilingual EN+ES. |
| `CHANGELOG.md` | Modified at close | New `[0.4.0]` section. |
| `package.json` | Modified at close | `version: "0.4.0"`. |
| Obsidian `0-Index.md` | Modified | Status flip + 5 new spec rows. |
| Obsidian `0-README.md` | Modified | State + version table. |
| Obsidian `3-Tech-Stack/0-Stack.md` | Modified | Versions or pointer. |
| Obsidian `7-Roadmap/0-Roadmap.md` | Modified | 3 status flips + v0.3.1 note. |
| Obsidian `5-Modules/8-Module-Package-Map.md` | **New** | Module↔Package table. |
| `openspec/specs/RENAMED-validation.md` | **New** | 1-paragraph rename note. |
| `openspec/specs/auth-login/FOLDED-rbac.md` | **New** | 1-paragraph fold note. |

No runtime, test, schema, CI, or build-affecting files are touched.

---

## Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | Bilingual section ordering breaks GitHub or Obsidian renderers (mismatched anchors, broken `## Versión en Español` link) | Low | Use a single TOC at top; keep EN as the canonical section; treat ES as a clearly-marked secondary block. Verify both render in a preview. |
| 2 | Obsidian wikilinks break if folder/file names change during the refresh (e.g., renaming `5-Modules/7-…` to insert the new `8-Module-Package-Map.md`) | Low | Do NOT rename any existing Obsidian file; insert the new file with a high number (`8-`) and add cross-links manually. If `0-Index.md` references a number that no longer matches, fix the link inline. |
| 3 | OpenSpec note files (`RENAMED-*.md`, `FOLDED-*.md`) get treated as spec capabilities by future sdd-spec agents | Low | Name with `RENAMED-` / `FOLDED-` prefix so they sort to the end of capability lists; add a one-line header `> **Note, not a capability**` at the top. |
| 4 | Module-Package map goes stale within weeks as `athlos-ui` / `athlos-deploy` land | Med | Add a "Last reviewed: 2026-06-18" stamp at the top so a future sdd-* sub-agent is prompted to re-verify. The CI drift-check guard is **deferred** (not in scope) but flagged for a later change. |
| 5 | Version bump + CHANGELOG edit happen mid-PR and violate project convention | Med | The proposal explicitly says "at PR close"; the apply sub-agent must add a checklist reminder; the orchestrator must verify both edits are in the closing commit only. |

---

## Acceptance Criteria

- [ ] `README.md` mentions **Next.js 16.2.9**, **Fastify 5**, **PostgreSQL 16**, **Drizzle ORM** (not "coming in PR 2"), **16 internal packages + 4 integration adapters**, **439/439 tests passing**, and includes a clearly-marked Spanish section (`## Versión en Español` or equivalent).
- [ ] `README.md` no longer contains the strings `Next.js 15`, `Drizzle lands in PR 2`, or `coming in PR 2+`.
- [ ] Obsidian `0-Index.md` shows `athlos-import-completion` as **archived 2026-06-18** (not "en curso") and lists all 5 import-completion specs (`audit-logger`, `drift-detector`, `freshness-monitor`, `lineage-tracker`, `projection-engine`).
- [ ] Obsidian `0-README.md` `Estado` reads `v0.3.1 shipped` (or `v0.4.0` if closed by then) and the tech-stack block either shows the real versions or defers to `2-Architecture/0-Decisions.md`.
- [ ] Obsidian `3-Tech-Stack/0-Stack.md` versions match `2-Architecture/0-Decisions.md`.
- [ ] Obsidian `7-Roadmap/0-Roadmap.md` shows PR 7b.1a, 7b.1b, and 7b.2 as ✅ (not ⏳) and includes a v0.3.1 hotfix note.
- [ ] Obsidian `5-Modules/8-Module-Package-Map.md` exists and lists **9 product modules** and **16 internal packages + 4 integration adapters** in a single table; unimplemented modules are explicitly flagged.
- [ ] `openspec/specs/RENAMED-validation.md` exists with a 1-paragraph note explaining the `validation-zod/` → `validation/` rename and pointing to `validation/spec.md`.
- [ ] `openspec/specs/auth-login/FOLDED-rbac.md` exists with a 1-paragraph note explaining the absorption of `user-management-rbac/` content into `auth-login/spec.md`.
- [ ] No file under `apps/`, `packages/`, `docs/runbook.md`, `.github/`, or any test / migration / source directory is modified.
- [ ] `package.json` version is `0.4.0` **only at PR close** (not in the main docs commit).
- [ ] `CHANGELOG.md` `[0.4.0]` entry exists **only at PR close**.
- [ ] All commits follow Conventional Commits, branch from `origin/main`, no AI co-author trailers.
- [ ] Total changed lines (excluding generated lockfile / dist): **<400** (single-PR budget).

---

## Review Workload Forecast

| Metric | Estimate |
|---|---|
| Files modified in repo | 2–3 (`README.md`, `CHANGELOG.md` at close, `package.json` at close) |
| Files modified in Obsidian vault | 4 (`0-Index.md`, `0-README.md`, `3-Tech-Stack/0-Stack.md`, `7-Roadmap/0-Roadmap.md`) |
| Files added in Obsidian vault | 1 (`5-Modules/8-Module-Package-Map.md`) |
| Files added in `openspec/specs/` | 2 (`RENAMED-validation.md`, `auth-login/FOLDED-rbac.md`) |
| **Estimated changed lines (repo + OpenSpec only)** | **~200–300** |
| **Estimated changed lines (Obsidian only)** | **~100–150** |
| 400-line budget risk | **LOW** (well under budget; biggest single file is `README.md` at ~100–150 lines after rewrite) |
| Chained PRs recommended | **No** — single PR keeps the doc refresh atomic and reviewable as one change |
| Suggested split | N/A |
| Expected review focus | Wording (README bilingual), accuracy of module↔package map, no scope creep into `athlos-ui` / `athlos-deploy` |

---

## Open Questions

None — the user pre-locked every meaningful fork (Module map = IN, CI guard = OUT, README = bilingual, version = v0.4.0 at close, delivery = single PR, OpenSpec hygiene = IN with note files).

One micro-decision deferred to apply: if an `apps/*/package.json` declares a top-level `version` field, bump it too at PR close. Trivial; surface in the closing commit only.

---

## Next Step

Ready for **sdd-spec** (delta specs covering: `doc-bilingual-readme` for the EN+ES section split, `module-package-map` for the new Obsidian table, and `openspec-hygiene-notes` for the `RENAMED-*` / `FOLDED-*` files). All three are additive capabilities with no behavior change.
