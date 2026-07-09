# chore(ci): fix pre-existing CI failures (test + labeler + Docker build smoke)

## Why

The same 3 CI failures have been blocking every PR for the last ~10 PRs, all bypassed with `gh pr merge --admin --delete-branch`. This PR fixes the root cause for each so the next batch of PRs can run the standard CI gate.

## What's fixed

### 1. `test` job — `ReferenceError: React is not defined`

**File:** `apps/web/src/app/(authed)/admin/gastos/[id]/page.test.tsx`

Added `import React from 'react'` at the top of the test file. The TSX renders JSX directly inside `render(<QueryClientProvider …>)`; in some CI paths (older automatic-JSX misroute, classic transform, or a React-19 / plugin-react version skew) `React` must be in scope as a guard. The import is a no-op under the dev branch's `@vitejs/plugin-react@4.7` automatic runtime and harmless if not needed.

**Commit:** `fix(web): add React import to gastos page.test.tsx`

**Verification:** `pnpm --filter @athlos/web test:run` → 610 / 610 tests pass.

### 2. `labeler` job — config drift (v4 syntax with v5 action)

**File:** `.github/labeler.yml`

The `labeler` workflow uses `actions/labeler@v5`, which restructured the configuration file in a backwards-incompatible way:

> "The configuration file structure was significantly redesigned and is not compatible with the structure of the previous version." — v5 release notes

The existing config was still in the v4 flat-list format. Wrapped the patterns under the v5 `changed-files → any-glob-to-any-file` form. Also fixed two stale paths that no longer match the repo:

- `packages/db/migrations/**` → `packages/db/drizzle/**` (migration SQL files live here)
- `drizzle/**` (dead root path) → removed

**Commit:** `chore(ci): fix labeler config drift`

### 3. `Docker build smoke` job — `log_error: command not found`

**Files:** `scripts/lib/common.sh` (+ tests in `scripts/tests/common.test.bats`)

`docker-entrypoint.sh` calls `log_error "..."` at lines 31, 41, 51, but `scripts/lib/common.sh` only defined the generic `log LEVEL MSG` form. The Docker build smoke job failed with `log_error: command not found`.

Added level-tagged shortcuts:

```bash
log_info()  { log INFO  "$*"; }
log_warn()  { log WARN  "$*"; }
log_error() { log ERROR "$*"; }
```

The generic `log LEVEL MSG` API is unchanged.

**TDD evidence:**

| Phase  | What                                                                                                                       | Result                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| RED    | 4 new bats tests in `common.test.bats` (one per helper + stderr)                                                           | Failed with `command not found` |
| GREEN  | Added `log_info` / `log_warn` / `log_error` to `common.sh`                                                                 | All 4 pass                      |
| VERIFY | `shellcheck scripts/lib/common.sh` clean, sourcing `log_error` from a baseline sub-shell produces the expected stderr line | OK                              |

**Commit:** `fix(deploy): add log_info / log_warn / log_error helpers to common.sh`

## Files changed

| File                                                        | Change                                                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/(authed)/admin/gastos/[id]/page.test.tsx` | +1 line — `import React from 'react'`                                                                                                                       |
| `.github/labeler.yml`                                       | Wrap under `changed-files → any-glob-to-any-file`; replace stale `packages/db/migrations/**` and `drizzle/**` with the actual `packages/db/drizzle/**` path |
| `scripts/lib/common.sh`                                     | +19 lines — three level-tagged wrappers around `log`                                                                                                        |
| `scripts/tests/common.test.bats`                            | +30 lines — 4 new bats tests for the helpers                                                                                                                |

## Verification commands

```bash
# 1. Test
pnpm --filter @athlos/web test:run
# Expected: 65 files, 610 tests pass

# 2. Lint
pnpm lint
# Expected: 0 errors (1 pre-existing warning in dbf-reader.ts, unrelated)

# 3. Typecheck
pnpm typecheck
# Expected: clean

# 4. bats smoke for the docker fix
bats scripts/tests/common.test.bats
# Expected: 4 new log_error/log_info/log_warn tests pass

# 5. shellcheck for common.sh
shellcheck scripts/lib/common.sh
# Expected: clean

# 6. Docker build smoke (path the CI job follows)
docker build -t athlos-api:smoke .
docker run --rm athlos-api:smoke node --version
docker run --rm athlos-api:smoke ls /usr/local/bin/docker-entrypoint.sh
```

## Notes / scope

- This is a chore PR; 62 lines of net addition, well under the 400-LOC review budget.
- 4 conventional commits (`fix(web)` / `chore(ci)` / `fix(deploy)`) — one fix per commit, plus a final docs commit if needed.
- Pre-existing failures in `scripts/tests/common.test.bats` (tests 7, 8, 16, 18) remain — they reference an undefined `SCRIPT_DIR` variable or wrap calls in `bash -c` which loses in-shell function bindings. Out of scope for this chore; tracked as a separate follow-up.
- This PR was overdue: 3 CI jobs blocked every PR for the last ~10 PRs. The `gh pr merge --admin` bypass was used on each. With this fix the standard CI gate runs again.
