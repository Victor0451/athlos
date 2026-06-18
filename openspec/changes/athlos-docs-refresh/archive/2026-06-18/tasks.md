# Tasks: athlos-docs-refresh

## Header

| Field | Value |
|-------|-------|
| Change | athlos-docs-refresh |
| Date | 2026-06-18 |
| Phase | tasks |
| Mode | both (Engram + OpenSpec) |
| Status | written |
| Strict TDD | **NOT APPLICABLE** — doc-only / hygiene change; no code, no tests, no schema, no API |
| Work-unit format | Enabled (each task = 1 commit on `feat/athlos-docs-refresh`) |

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~350 (200-300 repo + 100-150 Obsidian + ~30 hygiene notes) |
| 400-line budget risk | **LOW** |
| Chained PRs recommended | **No** |
| Suggested split | Single PR, 2 commits (docs + release) |
| Delivery strategy | single-pr |
| Chain strategy | N/A |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: N/A
400-line budget risk: Low

## Task Summary

| ID | Title | Capability | Depends on | Est. lines | Work unit |
|----|-------|-----------|-----------|-----------|-----------|
| TASK-001 | Refresh README.md (EN section) | doc-bilingual-readme | none | ~80 | 1 commit |
| TASK-002 | Add ES section to README.md | doc-bilingual-readme | TASK-001 | ~80 | 1 commit |
| TASK-003 | Refresh Obsidian 3-Tech-Stack/0-Stack.md | doc-bilingual-readme | TASK-002 | ~20 | 1 commit |
| TASK-004 | Refresh Obsidian 0-README.md | doc-bilingual-readme | TASK-003 | ~15 | 1 commit |
| TASK-005 | Refresh Obsidian 0-Index.md | doc-bilingual-readme | TASK-004 | ~25 | 1 commit |
| TASK-006 | Refresh Obsidian 7-Roadmap/0-Roadmap.md | doc-bilingual-readme | TASK-005 | ~20 | 1 commit |
| TASK-007 | Create Obsidian 5-Modules/8-Module-Package-Map.md | module-package-map | TASK-006 | ~60 | 1 commit |
| TASK-008 | Create openspec/specs/RENAMED-validation.md | openspec-hygiene-notes | TASK-007 | ~15 | 1 commit |
| TASK-009 | Create openspec/specs/auth-login/FOLDED-rbac.md | openspec-hygiene-notes | TASK-008 | ~15 | 1 commit |
| TASK-010 | Pre-closing verification | cross-cutting | TASK-009 | ~10 | 1 commit |
| TASK-011 | Closing commit (v0.4.0 release) | release | TASK-010 | ~10 | 1 commit |
| **Total** | **11 tasks** | | | **~350** | **11 commits** |
| **Implementation status** | ✅ All 11 tasks complete (10 commits — TASK-001 and TASK-002 combined into 1 commit since bilingual README required both sections together) |

---

## Tasks (in order)

### TASK-001: Refresh README.md (EN section)

**Capability:** doc-bilingual-readme
**Depends on:** none
**Estimated lines:** ~80
**Work unit:** 1 commit

**Description:**
Refresh the English section of `README.md` to reflect current project state. Add a top-level Table of Contents, the `> Versiones ancladas:` version callout block, and update all tech-stack versions, package/adapter counts, and test counts. Do NOT add the Spanish heading `## Versión en Español` yet — that belongs to TASK-002. Ensure distinct heading text per language so the two sections are structurally parallel but not duplicated.

**Files:**
- `README.md` — modify (EN section refresh only)

**Acceptance criteria:**
- [x] `README.md` contains top-level ToC with anchor links to all major sections
- [x] `> Versiones ancladas:` callout block present with: Next.js 16.2.9, Fastify 5, Postgres 16, pnpm 9.15.9, Node 22, TypeScript 5.7.2 strict
- [x] States: 2 apps, 18 packages, 4 integration adapters, 439 tests
- [x] `pnpm test` command shown
- [x] `## Versión en Español` heading present (written together with EN section in same commit — see TASK-002 note)
- [x] `grep -E "Next 16\.|Fastify 5|Postgres 16|pnpm 9\." README.md` returns hits for both EN and ES blocks

**Commit message:**
```
docs(README): refresh EN section with ToC and anchored versions

- Add top-level Table of Contents with anchor links
- Add > Versiones ancladas: callout with Next.js 16.2.9, Fastify 5,
  Postgres 16, pnpm 9.15.9, Node 22, TypeScript 5.7.2 strict
- Update to 2 apps, 18 packages, 4 adapters, 439 tests
- Add pnpm test command
- Spanish section added in follow-up commit
```

---

### TASK-002: Add ES section to README.md

**Capability:** doc-bilingual-readme
**Depends on:** TASK-001
**Estimated lines:** ~80
**Work unit:** 1 commit

**Description:**
Add the `## Versión en Español` section to `README.md`, mirroring the EN content with Spanish headings (e.g., `## Descripción` not `## Overview`). Versions must be identical to the EN block — no silent drift. This task ensures bilingual parity; any heading restructure in EN was done in TASK-001.

**Files:**
- `README.md` — modify (add ES section)

**Acceptance criteria:**
- [x] `## Versión en Español` heading present with Spanish-language subsections
- [x] All Spanish headings are distinct from EN headings (e.g., `## Descripción` ≠ `## Overview`)
- [x] `> Versiones ancladas:` callout present in ES block with identical version strings
- [x] `grep -E "Next 16\.|Fastify 5|Postgres 16|pnpm 9\." README.md` returns hits for both EN and ES blocks
- [x] No version drift between EN and ES blocks
- [x] **Note:** ES section written in same commit as TASK-001 (e2a3570) — bilingual structure required both sections together

**Commit message:**
```
docs(README): add Spanish section with mirrored content and identical versions

- Add ## Versión en Español heading with Spanish subsections
- Use distinct Spanish headings (Descripción, Stack Tecnológico, etc.)
- Mirror EN content: ToC, version callout, counts, test command
- Verify no silent version drift between EN and ES blocks
```

---

### TASK-003: Refresh Obsidian 3-Tech-Stack/0-Stack.md

**Capability:** doc-bilingual-readme
**Depends on:** TASK-002
**Estimated lines:** ~20
**Work unit:** 1 commit

**Description:**
Align the versions in `<obsidian>/3-Tech-Stack/0-Stack.md` with those documented in `2-Architecture/0-Decisions.md` (the source-of-truth for tech-stack decisions). This ensures Obsidian stays consistent with the ADRs after the refresh.

**Files:**
- `<obsidian>/3-Tech-Stack/0-Stack.md` — modify

**Acceptance criteria:**
- [x] All versions in `0-Stack.md` match those in `2-Architecture/0-Decisions.md`
- [x] `grep -E "Next 16\.|Fastify 5|Postgres 16|pnpm 9\." <obsidian>/3-Tech-Stack/0-Stack.md` returns hits

**Commit message:**
```
docs(obsidian): align 3-Tech-Stack/0-Stack.md with ADR versions

- Sync Next.js, Fastify, Postgres, pnpm, Node, TypeScript versions
- Use 2-Architecture/0-Decisions.md as source of truth
```

---

### TASK-004: Refresh Obsidian 0-README.md

**Capability:** doc-bilingual-readme
**Depends on:** TASK-003
**Estimated lines:** ~15
**Work unit:** 1 commit

**Description:**
Update `<obsidian>/0-README.md` so the project status reflects v0.3.1 as the last shipped version. The tech stack table must accurately represent the v0.3.1 state (not older, not speculative future state).

**Files:**
- `<obsidian>/0-README.md` — modify

**Acceptance criteria:**
- [x] States "v0.3.1 shipped" (or equivalent language for a shipped version)
- [x] Tech stack table reflects v0.3.1 technology choices
- [x] No reference to v0.3.0 or earlier as current

**Commit message:**
```
docs(obsidian): update 0-README.md to reflect v0.3.1 shipped state

- Mark v0.3.1 as last shipped version
- Update tech stack table to v0.3.1 choices
```

---

### TASK-005: Refresh Obsidian 0-Index.md

**Capability:** doc-bilingual-readme
**Depends on:** TASK-004
**Estimated lines:** ~25
**Work unit:** 1 commit

**Description:**
Update `<obsidian>/0-Index.md` so the `athlos-import-completion` row reads "archivado 2026-06-18" (NOT "en curso"). Ensure all 5 import-completion spec rows are present and correctly labeled. This closes out the import-completion workstream in the Obsidian index.

**Files:**
- `<obsidian>/0-Index.md` — modify

**Acceptance criteria:**
- [x] `grep -c "archivado" <obsidian>/0-Index.md` returns ≥ 2
- [x] `athlos-import-completion` row reads "archivado 2026-06-18"
- [x] All 5 import-completion spec rows present
- [x] No row shows "en curso" for import-completion

**Commit message:**
```
docs(obsidian): mark athlos-import-completion as archivado in 0-Index.md

- Change import-completion status from "en curso" to "archivado 2026-06-18"
- Verify all 5 import-completion spec rows present
```

---

### TASK-006: Refresh Obsidian 7-Roadmap/0-Roadmap.md

**Capability:** doc-bilingual-readme
**Depends on:** TASK-005
**Estimated lines:** ~20
**Work unit:** 1 commit

**Description:**
Update `<obsidian>/7-Roadmap/0-Roadmap.md` to mark items 7b.1a, 7b.1b, and 7b.2 as complete (✅). Add a v0.3.1 hotfix note where appropriate. This reflects the current roadmap state after the athlos-docs-refresh work.

**Files:**
- `<obsidian>/7-Roadmap/0-Roadmap.md` — modify

**Acceptance criteria:**
- [x] Items 7b.1a, 7b.1b, and 7b.2 marked ✅
- [x] v0.3.1 hotfix note present where relevant
- [x] Roadmap reflects completed state of refresh work

**Commit message:**
```
docs(obsidian): mark 7b.1a/7b.1b/7b.2 complete in 7-Roadmap/0-Roadmap.md

- Mark 7b.1a, 7b.1b, 7b.2 as ✅ complete
- Add v0.3.1 hotfix note
```

---

### TASK-007: Create Obsidian 5-Modules/8-Module-Package-Map.md

**Capability:** module-package-map
**Depends on:** TASK-006
**Estimated lines:** ~60
**Work unit:** 1 commit

**Description:**
Create `<obsidian>/5-Modules/8-Module-Package-Map.md` documenting the mapping between business modules and their code-package homes. The file must have a 9-row table (Padrón, Cuenta Corriente, Auth/Roles, Disciplinas, Escuela, Contabilidad, Tesorería, Cuota Social, Reportes) with columns: primary code home, packages used, status, last reviewed. Header note: `> Last reviewed: 2026-06-18`. Status enum: `shipped | legacy-only | partial | not yet started`. Padrón and Cuenta Corriente must be `shipped`; Auth/Roles `partial`; infer the rest from `apps/api/src/modules/` contents.

**Files:**
- `<obsidian>/5-Modules/8-Module-Package-Map.md` — create

**Acceptance criteria:**
- [x] File created at correct path
- [x] `> Last reviewed: 2026-06-18` header present
- [x] 9-row table with correct columns (primary code home, packages used, status, last reviewed)
- [x] Padrón → `shipped`, Cuenta Corriente → `shipped`, Auth/Roles → `partial`
- [x] All 9 modules present with statuses determined by inspection of `apps/api/src/modules/`
- [x] `ls <obsidian>/5-Modules/8-*.md` returns the new file

**Commit message:**
```
docs(obsidian): create 5-Modules/8-Module-Package-Map.md with 9-module inventory

- Add 9-row table: Padrón, Cuenta Corriente, Auth/Roles, Disciplinas,
  Escuela, Contabilidad, Tesorería, Cuota Social, Reportes
- Columns: primary code home, packages used, status, last reviewed
- Status enum: shipped | legacy-only | partial | not yet started
- Padrón/Cuenta Corriente: shipped; Auth/Roles: partial
```

---

### TASK-008: Create openspec/specs/RENAMED-validation.md

**Capability:** openspec-hygiene-notes
**Depends on:** TASK-007 (or independent)
**Estimated lines:** ~15
**Work unit:** 1 commit

**Description:**
Create `openspec/specs/RENAMED-validation.md` — a NOTE file (not a capability) documenting the `validation-zod/` → `validation/` rename. Line 1 must be literally `> **Note, not a capability**`. No `### Requirement:` blocks. Serves as a breadcrumb for future maintainers navigating the OpenSpec hygiene notes.

**Files:**
- `openspec/specs/RENAMED-validation.md` — create

**Acceptance criteria:**
- [x] Line 1 is literally `> **Note, not a capability**`
- [x] Documents `validation-zod/` → `validation/` rename
- [x] No `### Requirement:` block present
- [x] `head -1 openspec/specs/RENAMED-validation.md` returns the note marker

**Commit message:**
```
chore(openspec): add RENAMED-validation.md hygiene note for rename breadcrumb

- Note file (not a capability) documenting validation-zod/ → validation/ rename
- No requirements section; serves as maintainer breadcrumb
```

---

### TASK-009: Create openspec/specs/auth-login/FOLDED-rbac.md

**Capability:** openspec-hygiene-notes
**Depends on:** TASK-008
**Estimated lines:** ~15
**Work unit:** 1 commit

**Description:**
Create `openspec/specs/auth-login/FOLDED-rbac.md` — a NOTE file (not a capability) documenting the absorption of `user-management-rbac/` into `auth-login/`. Line 1 must be literally `> **Note, not a capability**`. No `### Requirement:` blocks. Completes the hygiene note set for this change.

**Files:**
- `openspec/specs/auth-login/FOLDED-rbac.md` — create

**Acceptance criteria:**
- [x] Line 1 is literally `> **Note, not a capability**`
- [x] Documents `user-management-rbac/` absorption into `auth-login/`
- [x] No `### Requirement:` block present
- [x] `head -1 openspec/specs/auth-login/FOLDED-rbac.md` returns the note marker

**Commit message:**
```
chore(openspec): add FOLDED-rbac.md hygiene note for folded capability breadcrumb

- Note file (not a capability) documenting user-management-rbac/ absorption
- No requirements section; serves as maintainer breadcrumb
```

---

### TASK-010: Pre-closing verification

**Capability:** cross-cutting
**Depends on:** TASK-009
**Estimated lines:** ~10
**Work unit:** 1 commit

**Description:**
Run all grep verification commands from design section 8 and document the results. This task is a documentation commit that records that all acceptance criteria have been met before the release commit. If any grep fails, this task is where the failure is caught and reported.

**Files:**
- (no file changes; verification only)

**Acceptance criteria:**
- [x] `grep -E "Next 16\.|Fastify 5|Postgres 16|pnpm 9\." README.md` → hits both EN and ES blocks
- [x] `grep -c "archivado" <obsidian>/0-Index.md` ≥ 2
- [x] `ls <obsidian>/5-Modules/8-*.md` → returns the new file
- [x] `head -1 openspec/specs/RENAMED-validation.md` → returns `> **Note, not a capability**`
- [x] `head -1 openspec/specs/auth-login/FOLDED-rbac.md` → returns `> **Note, not a capability**`
- [x] `git log --oneline -5` → shows main docs commits + pending closing commit
- [x] All results documented in task report (commit message or associated note)

**Commit message:**
```
docs: pre-closing verification pass — all acceptance criteria green

- README EN+ES version grep: pass
- Obsidian archivado count ≥ 2: pass
- 8-Module-Package-Map.md exists: pass
- RENAMED-validation.md header: pass
- FOLDED-rbac.md header: pass
- git log shape verified: pass
```

---

### TASK-011: Closing commit (v0.4.0 release)

**Capability:** release
**Depends on:** TASK-010
**Estimated lines:** ~10
**Work unit:** 1 commit

**Description:**
Perform the version bump to v0.4.0 and add the CHANGELOG entry in a single SEPARATE commit after all docs work. This is the only commit that touches `package.json` or `CHANGELOG.md`. The bump must appear ONLY in HEAD (not in the parent commit). Run pre- and post-bump verification to confirm the bump is isolated to this commit.

**Files:**
- `package.json` — modify (version field only)
- `CHANGELOG.md` — modify (add `[0.4.0]` entry only)

**Acceptance criteria:**
- [x] `git show HEAD~1:package.json | grep version` shows pre-bump version (0.3.1 — verify commit doesn't touch package.json)
- [x] `git show HEAD:package.json | grep version` shows `0.4.0`
- [x] `CHANGELOG.md` has a `[0.4.0]` entry added
- [x] Closing commit message is exactly `chore(release): v0.4.0`
- [x] No other files modified in this commit (only package.json files + CHANGELOG.md)

**Commit message:**
```
chore(release): v0.4.0

- Bump version to 0.4.0
- Add [0.4.0] entry to CHANGELOG.md
- No other files touched
```

---

## Dependencies (visual)

```
TASK-001 → TASK-002 → TASK-003 → TASK-004 → TASK-005 → TASK-006 → TASK-007 → TASK-008 → TASK-009 → TASK-010 → TASK-011
```

Note: TASK-008 and TASK-009 are independently committable (no other task depends on the existence of the hygiene notes). The serial chain above is the recommended order. The executor may parallelize 008/009 only if it has isolated worktree access; in the standard `sdd-apply` flow they go in serial.

---

## Out of Scope (re-affirm)

- CI drift-check workflow
- Code, schema, API, tests, migrations
- Dependency upgrades
- `athlos-deploy` / `athlos-ui` / `athlos-e2e` work
- Bulk Obsidian cleanup (e.g., duplicate-row bug in `2-Architecture/3-Gaps-Analysis.md`)
- Retroactive rewrite of `athlos-foundation` archive
- Any version bump or CHANGELOG edit outside TASK-011

---

## Pre-apply Checklist (for orchestrator)

- [ ] Branch `feat/athlos-docs-refresh` created from `origin/main`
- [ ] All 11 tasks in `tasks.md` present
- [ ] `sdd-apply` sub-agent receives this file + proposal/spec/design paths
- [ ] Closing commit verification: orchestrator runs `git show HEAD~1 -- package.json | grep version` vs `git show HEAD -- package.json | grep version` after apply
