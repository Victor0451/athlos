# Archive Report: athlos-docs-refresh

**Change**: athlos-docs-refresh
**Date**: 2026-06-18
**Phase**: sdd-archive complete
**Mode**: both (OpenSpec files in repo + Engram copy)
**Status**: ✅ ARCHIVED

## Summary

Brings the repo `README.md`, four Obsidian entry points, and two undocumented OpenSpec migrations to v0.3.1 truth, and adds the missing module↔package map. No code, schema, API, or dep changes. Single PR (#6) merged to main at v0.4.0. 439/439 tests pass.

## Capabilities delivered (3 net-new, 0 modified)

1. **`doc-bilingual-readme`** — bilingual EN+ES `README.md` (216 lines) pinned to v0.3.1 truth
2. **`module-package-map`** — new `5-Modules/8-Module-Package-Map.md` (Obsidian) with 9 product modules × 20 packages/integrations
3. **`openspec-hygiene-notes`** — `RENAMED-validation.md` + `auth-login/FOLDED-rbac.md` documenting past migrations

## Commits (11 total, reverse chronological)

| SHA | Subject |
|-----|---------|
| `a1b4630` | Merge pull request #6 from Victor0451/feat/athlos-docs-refresh |
| `9b050a5` | docs(openspec): add athlos-docs-refresh planning artifacts |
| `eca3fa2` | chore(release): v0.4.0 |
| `3be106f` | chore(verify): pre-closing verification grep checks passed |
| `401cbd8` | chore(openspec): add FOLDED-rbac.md hygiene note for folded capability breadcrumb |
| `8848685` | chore(openspec): add RENAMED-validation.md hygiene note for rename breadcrumb |
| `d140edb` | docs(obsidian): create 5-Modules/8-Module-Package-Map.md with 9-module inventory |
| `c86f432` | docs(obsidian): mark 7b.1a/7b.1b/7b.2 complete in 7-Roadmap/0-Roadmap.md |
| `a6b15cf` | docs(obsidian): mark athlos-import-completion as archivado in 0-Index.md |
| `b94f485` | docs(obsidian): update 0-README.md to reflect v0.3.1 shipped state |
| `4352eef` | docs(obsidian): align 3-Tech-Stack/0-Stack.md with ADR versions |
| `e2a3570` | docs(README): refresh EN section with ToC and anchored versions |

## Specs synchronized to canonical `openspec/specs/`

| Capability | Requirements | Scenarios |
|------------|-------------|-----------|
| `doc-bilingual-readme/spec.md` | 4 | 4 |
| `module-package-map/spec.md` | 3 | 3 |
| `openspec-hygiene-notes/spec.md` | 3 | 3 |

## Hygiene notes (already in canonical location from apply)

- `openspec/specs/RENAMED-validation.md` (validation-zod → validation)
- `openspec/specs/auth-login/FOLDED-rbac.md` (user-management-rbac → auth-login)

## Out of scope (reaffirmed)

- CI drift-check workflow (deferred to follow-up)
- Code, schema, API, tests, migrations
- Dependency upgrades
- `athlos-deploy` / `athlos-ui` / `athlos-e2e` work

## Verification

- `pnpm test:run`: 439/439 pass
- `pnpm lint`: pass
- `pnpm typecheck`: pass
- 2-commit shape verified (docs + `chore(release): v0.4.0`)
- Convention compliance: ✓ no AI co-author, ✓ conventional commits

## Artifacts

- `openspec/changes/athlos-docs-refresh/archive/2026-06-18/{proposal,design,tasks,archive-report}.md`
- `openspec/changes/athlos-docs-refresh/archive/2026-06-18/specs/<capability>/spec.md` × 3
- `openspec/specs/<capability>/spec.md` × 3 (canonical)
- Engram topic `sdd/athlos-docs-refresh/archive-report`

## Engram observation IDs (for traceability)

- Spec (3 capabilities): id 2158
- Apply progress: id 2168
- Verify report: id 2171
- Project init: id 2047

## SDD cycle deviations/corrections

- TASK-001+002 combined into single commit `e2a3570` — bilingual structure required both EN and ES sections together
- 1 correction commit `9b050a5` added planning artifacts that apply missed

## Next steps

The repo is now at v0.4.0 with the doc-hygiene work done. Future sessions can start from a known-good state (v0.3.1 truth in README + Obsidian entry points). Follow-up changes:
- `athlos-deploy` (small-to-medium, high value, can run in parallel)
- `athlos-ui` and `athlos-e2e` (deferred until sizing exploration)
- CI drift-check (could be a small change on its own)
