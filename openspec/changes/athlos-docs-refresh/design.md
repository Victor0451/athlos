# Design: athlos-docs-refresh

- **Change name:** `athlos-docs-refresh`
- **Date:** 2026-06-18
- **Phase:** design
- **Mode:** both (Engram + OpenSpec filesystem)
- **Status:** designed
- **Branch base:** `origin/main`
- **File path:** `openspec/changes/athlos-docs-refresh/design.md`

---

## 1. Context

This is a **doc-only / hygiene change**. The code repo and Obsidian vault are at **v0.3.1** (shipped — `athlos-foundation` and `athlos-import-completion` archived), but every user-facing entry point still describes an earlier state: `README.md` claims Next 15 and "Drizzle lands in PR 2", `0-Index.md` lists `athlos-import-completion` as "en curso" one day after archive, `5-Modules/0-Inventory.md` enumerates 9 product modules with no map to the 16 shipped internal packages, and OpenSpec `specs/` carries two undocumented migrations (`validation-zod` → `validation` rename; `user-management-rbac` absorbed into `auth-login`).

Why now: every future session hits the same drift. Until the README, Obsidian entry points, and module↔package map reflect v0.3.1 truth, every new contributor and every `sdd-*` sub-agent has to re-derive what is shipped vs planned. This change closes that gap before the next follow-up (`athlos-deploy`, `athlos-ui`, or `athlos-e2e`) starts. No code, schema, API, or test is touched.

---

## 2. Goals / Non-Goals

**Goals**

- `README.md` is bilingual EN + ES and reflects v0.3.1 truth (Next 16.2.9, Fastify 5, Postgres 16, Drizzle shipped, 439/439 tests, 16 + 4 packages).
- Obsidian entry points (`0-Index.md`, `0-README.md`, `3-Tech-Stack/0-Stack.md`, `7-Roadmap/0-Roadmap.md`) match the shipped state.
- New Obsidian `5-Modules/8-Module-Package-Map.md` maps all 9 product modules to code homes + packages + status.
- Two OpenSpec hygiene notes (`RENAMED-validation.md`, `auth-login/FOLDED-rbac.md`) document in-place migrations.
- Single PR; v0.4.0 version bump and `[0.4.0]` CHANGELOG entry land in the **closing commit only**.

**Non-Goals**

- CI drift-check workflow (deferred — needs `.github/workflows/` file + version grep harness).
- Code, schema, API, dependency, or test changes.
- `athlos-ui` / `athlos-deploy` / `athlos-e2e` planning — these are follow-up changes.
- Retroactive `athlos-foundation` archive fix for the `validation-zod` / `user-management-rbac` moves.
- `2-Architecture/3-Gaps-Analysis.md` duplicate-row fix (small standalone task).
- Version bump or CHANGELOG edit inside the main docs commit (project convention: close-only).

---

## 3. Architecture / Approach

### 3.1 README.md — bilingual structure

**Section order** (single `# Athlos` title, one shared ToC, language-labeled sections):

```
# Athlos
## Table of Contents          <- lists EN sections + "Versión en Español"

--- English section (canonical) ---
## Overview
## Prerequisites
## Quick Start
## Layout
## Stack                      <- version-pin line: "> Versions pinned: Next 16.2.9 · Fastify 5 · Postgres 16 · pnpm 9.15.9 · Node 22 · TS 5.7.2 (strict)"
## Development
## Testing
## Packages & Modules

--- Spanish section (mirrors EN) ---
## Versión en Español
## Descripción
## Requisitos previos
## Inicio rápido
## Stack                     <- same version-pin line in Spanish
## Desarrollo
## Pruebas
## Paquetes y Módulos
```

**Anchor collision avoidance**: EN and ES headings are intentionally **not translated 1:1 in heading text** — `Overview` ≠ `Descripción`, `Prerequisites` ≠ `Requisitos`. GitHub auto-generates anchors from heading text, so distinct heading text guarantees distinct anchors (`#overview`, `#descripción`, `#prerequisites`, etc.). ToC references link to the language-appropriate anchor.

**No-silent-drift enforcement**: every EN and ES content block carries a `> Versiones ancladas: Next 16.2.9 · Fastify 5 · Postgres 16 · ...` callout near the top. Both blocks MUST carry the same numbers in the same commit. The spec's grep-check (`Next.js 15`, `Drizzle lands in PR 2`, `coming in PR 2+`) MUST pass in both languages.

**Shipped vs planned**: EN section "Packages & Modules" lists shipped packages with ✅ marker, then a sub-block "Planned (follow-up changes)" listing `athlos-ui`, `athlos-deploy`, `athlos-e2e` with `not yet started`. ES section mirrors.

### 3.2 Obsidian refresh — file-by-file edits

| File | Edit |
|------|------|
| `3-Tech-Stack/0-Stack.md` | Replace the version block with a pointer to `2-Architecture/0-Decisions.md` (which is already correct). Single source of truth. |
| `0-README.md` | Flip `Estado` line to `v0.3.1 shipped (2026-06-17)`; replace tech-stack table with real versions OR remove and defer to `0-Decisions.md`. |
| `0-Index.md` | Line 9: `athlos-import-completion` → `archivado el 2026-06-17`. Section "En curso" → "Cerrado". Lines 33–35 (PR 7b.1a/7b.1b/7b.2) flip ⏳ → ✅ for all three. Add 5 import-completion spec rows (`audit-logger`, `drift-detector`, `freshness-monitor`, `lineage-tracker`, `projection-engine`) to section 2 if missing. |
| `7-Roadmap/0-Roadmap.md` | Same 7b.1a/7b.1b/7b.2 flips (⏳ → ✅); add a 1-paragraph v0.3.1 hotfix note under the implementation status section. |

No file rename. No folder restructure. Wikilinks stay intact.

### 3.3 Module map construction

**Procedure**:

1. Open `5-Modules/0-Inventory.md` (canonical product list — confirmed 9 modules: Padrón, Cuenta Corriente, Auth/Roles, Disciplinas, Escuela, Contabilidad, Tesorería, Cuota Social, Reportes).
2. For each module, verify the primary code home:
   - `ls apps/api/src/modules/{ctacte,padrones,socios}` (3 code homes confirmed).
   - Padron → `apps/api/src/modules/padrones` (and `socios` overlaps as legacy).
   - Auth/Roles → `apps/api/src/modules/socios` (operators + roles live here per foundation archive).
   - Disciplinas, Escuela, Contabilidad, Tesorería, Cuota Social, Reportes → no dedicated folder yet → status `not yet started` with pointer to `athlos-ui` / `athlos-deploy`.
3. Verify each module's packages used by grepping `@athlos/*` imports under `apps/api/src/modules/<home>/`. Record in table.
4. Header stamp `> Last reviewed: 2026-06-18`.

**Table format** (one filled-in example, eight skeleton rows):

```
| Module | Primary code home | Packages used | Status |
|---|---|---|---|
| Padrón | `apps/api/src/modules/padrones` (legacy: `socios`) | `@athlos/db`, `@athlos/auth`, `@athlos/validation`, `@athlos/errors` | shipped |
| Cuenta Corriente | `apps/api/src/modules/ctacte` | `@athlos/db`, `@athlos/validation`, `@athlos/errors` | shipped |
| Auth/Roles | `apps/api/src/modules/socios` (operators) | `@athlos/auth`, `@athlos/db`, `@athlos/errors` | shipped |
| Disciplinas | — | — | not yet started |
| Escuela | — | — | not yet started |
| Contabilidad | — | — | not yet started |
| Tesorería | — | — | not yet started |
| Cuota Social | `apps/api/src/modules/ctacte` (subdomain) | `@athlos/db`, `@athlos/validation` | partial |
| Reportes | — | — | not yet started |
```

### 3.4 OpenSpec hygiene notes

Both files share the same template:

```markdown
# <Original name> — <rename|fold> note

> **Note, not a capability**

**Original**: `<old-name>/`
**Destination**: `<new-name>/spec.md` (or `<parent>/spec.md`)
**Observed**: 2026-06-18 (or exact date if known)

<1-paragraph rationale explaining why the move happened and pointing to the current home.>
```

- `openspec/specs/RENAMED-validation.md` — original `validation-zod/`, destination `validation/spec.md`. Rationale: validation became the canonical name once the underlying library choice (Zod) stopped being the discriminator (per `auth-login` and `api-design` archives).
- `openspec/specs/auth-login/FOLDED-rbac.md` — original `user-management-rbac/`, destination `auth-login/spec.md`. Rationale: RBAC content absorbed at foundation archive; see `openspec/changes/archive/2026-06-16-athlos-foundation/` for the pre-merge version.

Both files MUST NOT contain any `### Requirement:` block.

### 3.5 Closing-commit structure (mandatory 2-commit PR)

The PR carries **two commits on the same branch**:

1. **Main docs commit** (`docs: refresh to v0.4.0`):
   - `README.md` (bilingual rewrite)
   - Obsidian files (refreshed + new module map)
   - OpenSpec specs notes (RENAMED + FOLDED)
   - **MUST NOT** touch `package.json` or `CHANGELOG.md`.

2. **Closing commit** (`chore(release): v0.4.0`):
   - Root `package.json` → `version: "0.4.0"`
   - `CHANGELOG.md` → new `[0.4.0]` entry at top
   - Optionally bump `apps/*/package.json` if they declare a top-level `version` field (verify in apply; most likely not needed — apps are private workspace members).

`sdd-apply` MUST NOT collapse both into a single commit. Orchestrator verifies this on PR open.

---

## 4. File-by-File Changes

| File | Action | Expected Δ (lines) |
|------|--------|--------------------|
| `README.md` | Modify | +60 / -20 (rewrite 50→~110 lines, bilingual) |
| `package.json` | Modify at close only | ±1 |
| `CHANGELOG.md` | Modify at close only | +10 (new entry) |
| Obsidian `0-Index.md` | Modify | +5 / -3 (status flip + spec rows) |
| Obsidian `0-README.md` | Modify | +5 / -10 (state + tech stack) |
| Obsidian `3-Tech-Stack/0-Stack.md` | Modify | +3 / -15 (replace versions with pointer) |
| Obsidian `7-Roadmap/0-Roadmap.md` | Modify | +10 / -3 (3 status flips + hotfix note) |
| Obsidian `5-Modules/8-Module-Package-Map.md` | **Create** | +60 (header + 9-row table + footer) |
| `openspec/specs/RENAMED-validation.md` | **Create** | +15 |
| `openspec/specs/auth-login/FOLDED-rbac.md` | **Create** | +15 |

**Totals**: ~6 modified (2 in close-only commit), 4 created. ~200–350 changed lines.

---

## 5. Implementation Order

`sdd-apply` follows this sequence so each step is reviewable in isolation:

1. Refresh `README.md` (EN section). Self-verify with the spec's grep check.
2. Add `README.md` (ES section, mirrors EN). Self-verify version-pin callouts match.
3. Refresh Obsidian `3-Tech-Stack/0-Stack.md` (versions → pointer to `0-Decisions.md`).
4. Refresh Obsidian `0-README.md` (Estado + stack).
5. Refresh Obsidian `0-Index.md` (status flip + spec rows).
6. Refresh Obsidian `7-Roadmap/0-Roadmap.md` (3 status flips + hotfix note).
7. Create Obsidian `5-Modules/8-Module-Package-Map.md` (header stamp + 9-row table).
8. Create `openspec/specs/RENAMED-validation.md`.
9. Create `openspec/specs/auth-login/FOLDED-rbac.md`.
10. Open PR. Wait for review.
11. **Closing commit** (separate, on same branch): bump `package.json` to `0.4.0` + prepend `[0.4.0]` to `CHANGELOG.md`.
12. Merge.

---

## 6. Risks & Mitigations

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| 1 | Bilingual anchor/header collisions | Med | Distinct heading text per language (`Overview` ≠ `Descripción`); GitHub generates distinct anchors; ToC links to language-specific anchors. |
| 2 | Obsidian wikilinks break | Low | No file renames; new file gets `8-` prefix (highest existing number). Spot-check inline links after each Obsidian edit. |
| 3 | Note files mistaken for capabilities | Med | `RENAMED-` / `FOLDED-` filename prefixes sort to end of alphabetized lists; literal `> **Note, not a capability**` header on line 1; no `### Requirement:` block. |
| 4 | Module map goes stale within weeks | Med | `> Last reviewed: 2026-06-18` stamp at top; spec REQ-1 mandates re-applying stamp on every refresh. CI drift-check deferred (out of scope). |
| 5 | Closing-commit slippage (bump + CHANGELOG happen mid-PR) | Med | Section 3.5 explicitly mandates 2-commit structure; `sdd-apply` checklist + orchestrator PR-open verification. |
| 6 | ES translation quality drift from EN | Low | EN is canonical; ES mirrors EN structure and numbers; informal register is acceptable (user is the only ES reader per session context). |
| 7 | Module map claims a code home that doesn't exist | Med | Build procedure (3.3 step 2) requires `ls apps/api/src/modules/` verification before writing each row. Status `not yet started` is the safe default when no folder exists. |

---

## 7. Acceptance / Verification

User-runnable checks after apply:

```bash
# README bilingual version check
grep -E "Next\.?js 16\.2\.9|Fastify 5|Postgres 16|pnpm 9\.15\.9" README.md
# Expect: ≥2 hits (one in EN block, one in ES block)

# README stale-string check
! grep -E "Next\.?js 15|Drizzle lands in PR 2|coming in PR 2\+" README.md
# Expect: exit code 1 (no match)

# Obsidian 0-Index status flip
grep -c "archivado" /run/media/vlongo/Archivos/obsidian/Projectos/Athlos/0-Index.md
# Expect: ≥2 (foundation + import-completion)

# Module map exists
ls /run/media/vlongo/Archivos/obsidian/Projectos/Athlos/5-Modules/8-*.md
# Expect: one file

# Module map has all 9 modules
for m in Padrón "Cuenta Corriente" "Auth/Roles" Disciplinas Escuela Contabilidad Tesorería "Cuota Social" Reportes; do
  grep -q "$m" /run/media/vlongo/Archivos/obsidian/Projectos/Athlos/5-Modules/8-Module-Package-Map.md
done
# Expect: 9 hits

# OpenSpec note headers
head -1 openspec/specs/RENAMED-validation.md
head -1 openspec/specs/auth-login/FOLDED-rbac.md
# Expect: "> **Note, not a capability**" on both

# Closing commit is separate
git log --oneline -5
# Expect: last commit is chore(release): v0.4.0, NOT mixed with docs commit

# Version bump only in closing commit
git show HEAD~1:package.json | grep '"version"'   # main docs commit
git show HEAD:package.json | grep '"version"'     # closing commit
# Expect: 0.3.1 then 0.4.0
```

---

## 8. Review Workload Forecast

| Metric | Estimate |
|--------|----------|
| Files modified in repo | 3 (`README.md`, `package.json` at close, `CHANGELOG.md` at close) |
| Files modified in Obsidian vault | 4 (`0-Index.md`, `0-README.md`, `3-Tech-Stack/0-Stack.md`, `7-Roadmap/0-Roadmap.md`) |
| Files added in Obsidian vault | 1 (`5-Modules/8-Module-Package-Map.md`) |
| Files added in `openspec/specs/` | 2 (`RENAMED-validation.md`, `auth-login/FOLDED-rbac.md`) |
| **Total changed lines (estimated)** | **~350** (200–300 repo + 100–150 Obsidian + ~30 across 2 hygiene notes) |
| 400-line budget risk | **LOW** |
| Chained PRs recommended | **No** |
| Suggested split | **N/A** — single PR keeps the doc refresh atomic and reviewable as one change |
| 2-commit structure | Docs commit + closing release commit, both inside the single PR branch |

---

## 9. Open Questions

None — all user-locked decisions from the proposal carry forward (Module map IN, CI guard OUT, README bilingual, version v0.4.0 at close, single PR, OpenSpec hygiene as note files). One micro-decision deferred to apply: if `apps/*/package.json` declares a top-level `version` field, bump it in the closing commit only. Trivial; surface in the closing-commit checklist.