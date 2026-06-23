# Tasks: athlos-deploy-slice-b1b-usb-rotation

## Header

| Field | Value |
|-------|-------|
| Change | `athlos-deploy-slice-b1b-usb-rotation` |
| Date | 2026-06-23 |
| Phase | tasks |
| Mode | both (Engram + OpenSpec) |
| Status | written |
| Topic key | `sdd/athlos-deploy-slice-b1b-usb-rotation/tasks` |

## Contract

- **Strict TDD: ENABLED** — apply sub-agent must show RED → GREEN → REFACTOR in `apply-progress` for ALL 5 TDD chains. No exceptions.
- **Work-unit format: enabled** — 20 tasks = 20 commits, 1 work-unit per task
- **2-commit structure:** TDD commit (TASK-001..019) + `chore(release): v0.4.4` closing commit (TASK-020)
- **B1a LESSON (CRITICAL):** MODIFIED canonical sync is a recurring gap. TASK-019 must include atomic canonical sync self-verify via `diff`.

---

## Section 1: Task Summary

| ID | Title | Type | Depends on | Est. lines | Commit type |
|----|-------|------|-----------|-----------|-------------|
| TASK-001 | common.test.bats ADD 3 cases (RED) | TDD-RED | none | +30 | test(deploy) |
| TASK-002 | common.sh extend (GREEN) | TDD-GREEN | TASK-001 | +20 | feat(deploy) |
| TASK-003 | REFACTOR common.sh | TDD-REFACTOR | TASK-002 | varies | refactor(deploy) |
| TASK-004 | mount-usb.test.bats (RED) | TDD-RED | TASK-002 (need require_root) | ~40 | test(deploy) |
| TASK-005 | mount-usb.sh (GREEN) | TDD-GREEN | TASK-004 | ~40 | feat(deploy) |
| TASK-006 | REFACTOR mount-usb.sh | TDD-REFACTOR | TASK-005 | varies | refactor(deploy) |
| TASK-007 | unmount-usb.test.bats (RED) | TDD-RED | TASK-005 (so is_luks_open is callable) | ~25 | test(deploy) |
| TASK-008 | unmount-usb.sh (GREEN) | TDD-GREEN | TASK-007 | ~20 | feat(deploy) |
| TASK-009 | REFACTOR unmount-usb.sh | TDD-REFACTOR | TASK-008 | varies | refactor(deploy) |
| TASK-010 | backup-to-usb.test.bats (RED) | TDD-RED | TASK-008 (so unmount-usb is callable) | ~55 | test(deploy) |
| TASK-011 | backup-to-usb.sh (GREEN) | TDD-GREEN | TASK-010 | ~55 | feat(deploy) |
| TASK-012 | REFACTOR backup-to-usb.sh | TDD-REFACTOR | TASK-011 | varies | refactor(deploy) |
| TASK-013 | setup-usb.test.bats (RED) | TDD-RED | TASK-005 (so mount-usb is callable) | ~20 | test(deploy) |
| TASK-014 | setup-usb.sh (GREEN) | TDD-GREEN | TASK-013 | ~30 | feat(deploy) |
| TASK-015 | REFACTOR setup-usb.sh | TDD-REFACTOR | TASK-014 | varies | refactor(deploy) |
| TASK-016 | .env.example add 5 vars | config | TASK-005 | +5 | chore(env) |
| TASK-017 | docs/runbook.md add USB Rotation section | docs | none (independent) | ~15 net | docs(runbook) |
| TASK-018 | .github/workflows/test.yml extend backup-bats job | ci | TASK-015 | ~3 YAML | ci |
| TASK-019 | **Pre-closing verification + planning artifacts** | verify | TASK-001..018 | 0 | chore(verify) |
| TASK-020 | Closing commit: v0.4.3 → v0.4.4 + CHANGELOG | release | TASK-019 | ~10 | chore(release) |

---

## Section 2: Tasks (Detailed)

### TASK-001: common.test.bats ADD 3 cases (RED)

**Type:** TDD-RED
**Capability:** deployment-devops
**Depends on:** none
**Estimated lines:** ~30
**Work unit:** 1 commit

**Description:**
Write 3 new failing bats test cases for functions to be added to `common.sh`: `require_root` (exits 1 if not root), `is_mounted` (returns true/false for a given mount point), and `is_luks_open` (returns true/false for a given LUKS mapper name). These are the foundation functions needed by all USB rotation scripts.

**Files:**
- `scripts/tests/common.test.bats` — modify: ADD 3 new test cases

**Acceptance criteria:**
- [ ] `common.test.bats` has at least 3 NEW cases: `require_root`, `is_mounted`, `is_luks_open`
- [ ] All 3 NEW cases FAIL at this point (RED phase)
- [ ] B1a existing cases still pass
- [ ] `bats scripts/tests/common.test.bats` runs without syntax error

**Commit message:**
```
test(deploy): common.test.bats ADD require_root, is_mounted, is_luks_open cases

RED phase: write 3 failing test cases for functions that will be
added to common.sh in the GREEN phase. These support USB rotation scripts.
```

---

### TASK-002: common.sh extend (GREEN)

**Type:** TDD-GREEN
**Capability:** deployment-devops
**Depends on:** TASK-001
**Estimated lines:** ~20
**Work unit:** 1 commit

**Description:**
Implement the 3 functions in `common.sh` that make TASK-001's tests pass: `require_root` (guard that exits 1 if EUID != 0), `is_mounted` (checks `/proc/mounts` for given path), and `is_luks_open` (checks `/dev/mapper/` for given mapper name). Extend `lib/common.sh`.

**Files:**
- `lib/common.sh` — modify: ADD 3 functions after existing content

**Acceptance criteria:**
- [ ] `common.sh` is extended AFTER `common.test.bats`
- [ ] All 3 NEW cases from TASK-001 now PASS
- [ ] B1a cases still pass (no regression)
- [ ] `bats scripts/tests/common.test.bats` — all PASS

**Commit message:**
```
feat(deploy): common.sh ADD require_root, is_mounted, is_luks_open

GREEN phase: implement 3 functions tested in RED phase. require_root
guards script execution to root only; is_mounted checks /proc/mounts;
is_luks_open checks /dev/mapper/. All 3 support USB rotation scripts.
```

---

### TASK-003: REFACTOR common.sh

**Type:** TDD-REFACTOR
**Capability:** deployment-devops
**Depends on:** TASK-002
**Estimated lines:** varies
**Work unit:** 1 commit

**Description:**
Review `common.sh` after the green phase. Improve naming consistency, extract any repeated patterns, add doc comments to the 3 new functions. No behavior change — all bats tests must still pass.

**Files:**
- `lib/common.sh` — modify: refactor 3 new functions

**Acceptance criteria:**
- [ ] All bats tests still pass — `bats scripts/tests/common.test.bats`
- [ ] Each new function has a brief doc comment
- [ ] No behavior change from TASK-002
- [ ] Code is cleaner than after TASK-002

**Commit message:**
```
refactor(deploy): common.sh tidy require_root, is_mounted, is_luks_open

Add doc comments, improve naming consistency, extract any repeated
patterns. No behavior change — all bats tests still pass.
```

---

### TASK-004: mount-usb.test.bats (RED)

**Type:** TDD-RED
**Capability:** deployment-devops
**Depends on:** TASK-002 (need `require_root` in common.sh)
**Estimated lines:** ~40
**Work unit:** 1 commit

**Description:**
Write 5 failing bats test cases for `mount-usb.sh`: (1) success path with mocked USB + keyfile opens LUKS and mounts, exits 0; (2) wrong keyfile permissions → exits 1; (3) USB device not present → exits 2; (4) already mounted → exits 0 idempotent; (5) missing env var → exits 1. These tests define the expected behavior before implementation.

**Files:**
- `scripts/tests/mount-usb.test.bats` — create: 5 test cases

**Acceptance criteria:**
- [ ] `mount-usb.test.bats` has exactly 5 cases: success, wrong keyfile perms, USB not present, already mounted idempotent, missing env var
- [ ] All 5 cases FAIL at this point (RED phase)
- [ ] `bats scripts/tests/mount-usb.test.bats` runs without syntax error

**Commit message:**
```
test(deploy): mount-usb.test.bats ADD 5 cases for mount-usb.sh

RED phase: define expected behavior for USB mount script. Cases:
success, wrong keyfile perms, USB not present, already mounted
idempotent, missing env var. All fail until script is implemented.
```

---

### TASK-005: mount-usb.sh (GREEN)

**Type:** TDD-GREEN
**Capability:** deployment-devops
**Depends on:** TASK-004
**Estimated lines:** ~40
**Work unit:** 1 commit

**Description:**
Implement `mount-usb.sh` that: checks `USB_DEVICE` env var + `USB_KEYFILE` env var; calls `require_root`; verifies keyfile permissions (stat -c '%a' == 600 and owner is root:root); runs `cryptsetup open` with LUKS keyfile; creates mount point `/mnt/athlos-backup-usb` if missing; mounts with `mount /dev/mapper/athlos-backup-usb`. Exit codes: 0 success, 1 config/keyfile error, 2 USB not present. Includes `trap cleanup EXIT INT TERM` for any unmount on error path.

**Files:**
- `scripts/mount-usb.sh` — create: main script

**Acceptance criteria:**
- [ ] `mount-usb.sh` is created AFTER `mount-usb.test.bats`
- [ ] All 5 cases from TASK-004 now PASS
- [ ] Keyfile perms check via `stat -c '%a'` + `stat -c '%U:%G'` BEFORE `cryptsetup open`
- [ ] `trap cleanup EXIT INT TERM` for unmount on error
- [ ] `bash scripts/mount-usb.sh` with wrong keyfile perms → exits 1
- [ ] `bash scripts/mount-usb.sh` with USB unplugged → exits 2

**Commit message:**
```
feat(deploy): mount-usb.sh ADD USB LUKS open + mount script

GREEN phase: implement mount-usb.sh. Checks env vars USB_DEVICE and
USB_KEYFILE, verifies keyfile perms (600, root:root), opens LUKS
mapper athlos-backup-usb, creates and mounts at /mnt/athlos-backup-usb.
trap cleanup on EXIT/INT/TERM. Exit 1=error, 2=USB not present.
```

---

### TASK-006: REFACTOR mount-usb.sh

**Type:** TDD-REFACTOR
**Capability:** deployment-devops
**Depends on:** TASK-005
**Estimated lines:** varies
**Work unit:** 1 commit

**Description:**
Review `mount-usb.sh` for deduplication, clearer error messages, consistent variable naming, and any missing `set -e` / `set -u` guards. No behavior change.

**Files:**
- `scripts/mount-usb.sh` — modify: refactor

**Acceptance criteria:**
- [ ] All bats tests still pass — `bats scripts/tests/mount-usb.test.bats`
- [ ] Error messages are clear and consistent
- [ ] No behavior change from TASK-005
- [ ] `shellcheck scripts/mount-usb.sh` — clean

**Commit message:**
```
refactor(deploy): mount-usb.sh improve error messages and guards

Clarify error messages, add set -e/set -u where appropriate,
improve variable naming consistency. No behavior change.
```

---

### TASK-007: unmount-usb.test.bats (RED)

**Type:** TDD-RED
**Capability:** deployment-devops
**Depends on:** TASK-005 (so `is_luks_open` is callable from common.sh)
**Estimated lines:** ~25
**Work unit:** 1 commit

**Description:**
Write 3-4 failing bats test cases for `unmount-usb.sh`: (1) success — unmounts and closes LUKS, exits 0; (2) not mounted → exits 0 silent idempotent; (3) LUKS not open → skip close, exit 0; (4) missing env var → exits 1.

**Files:**
- `scripts/tests/unmount-usb.test.bats` — create: 3-4 test cases

**Acceptance criteria:**
- [ ] `unmount-usb.test.bats` has 3-4 cases: success, not mounted idempotent, LUKS not open skip, missing env var
- [ ] All cases FAIL at this point (RED phase)
- [ ] `bats scripts/tests/unmount-usb.test.bats` runs without syntax error

**Commit message:**
```
test(deploy): unmount-usb.test.bats ADD cases for unmount-usb.sh

RED phase: define expected behavior. Cases: success unmount+close,
not-mounted idempotent, LUKS-not-open skip close, missing env var.
All fail until script is implemented.
```

---

### TASK-008: unmount-usb.sh (GREEN)

**Type:** TDD-GREEN
**Capability:** deployment-devops
**Depends on:** TASK-007
**Estimated lines:** ~20
**Work unit:** 1 commit

**Description:**
Implement `unmount-usb.sh` that: calls `require_root`; checks `USB_MAPPER` env var; uses `is_mounted /mnt/athlos-backup-usb` — if mounted, runs `umount /mnt/athlos-backup-usb`; uses `is_luks_open athlos-backup-usb` — if open, runs `cryptsetup close athlos-backup-usb`; always removes mount point dir if empty; exits 0. CRITICAL: umount BEFORE cryptsetup close (order matters!).

**Files:**
- `scripts/unmount-usb.sh` — create: main script

**Acceptance criteria:**
- [ ] `unmount-usb.sh` is created AFTER `unmount-usb.test.bats`
- [ ] All cases from TASK-007 now PASS
- [ ] `umount` is called BEFORE `cryptsetup close` (order verified in code)
- [ ] `bash scripts/unmount-usb.sh` — exits 0, idempotent on already-unmounted

**Commit message:**
```
feat(deploy): unmount-usb.sh ADD USB unmount + LUKS close script

GREEN phase: unmounts /mnt/athlos-backup-usb then closes LUKS mapper
athlos-backup-usb. Order matters — umount BEFORE cryptsetup close.
Idempotent: if not mounted or not open, exits 0 silently.
```

---

### TASK-009: REFACTOR unmount-usb.sh

**Type:** TDD-REFACTOR
**Capability:** deployment-devops
**Depends on:** TASK-008
**Estimated lines:** varies
**Work unit:** 1 commit

**Description:**
Review `unmount-usb.sh` for error handling clarity, consistent naming, doc comments. No behavior change.

**Files:**
- `scripts/unmount-usb.sh` — modify: refactor

**Acceptance criteria:**
- [ ] All bats tests still pass — `bats scripts/tests/unmount-usb.test.bats`
- [ ] Each step has a brief doc comment
- [ ] No behavior change from TASK-008
- [ ] `shellcheck scripts/unmount-usb.sh` — clean

**Commit message:**
```
refactor(deploy): unmount-usb.sh add doc comments and polish

Improve error messages, add doc comments, consistent naming.
No behavior change — all bats tests still pass.
```

---

### TASK-010: backup-to-usb.test.bats (RED)

**Type:** TDD-RED
**Capability:** deployment-devops
**Depends on:** TASK-008 (so `unmount-usb.sh` is callable)
**Estimated lines:** ~55
**Work unit:** 1 commit

**Description:**
Write 6-7 failing bats test cases for `backup-to-usb.sh`: (1) full pipeline success with mocked mount+rsync+retention+unmount, exits 0; (2) mount fails → exit 2; (3) rsync fails → exit 3; (4) retention check fails → exit 3; (5) concurrency lock acquired, exits 0; (6) flock contention (lock held by another process) → exit 0 silent skip; (7) missing env var → exit 1. These define the complete weekly backup pipeline.

**Files:**
- `scripts/tests/backup-to-usb.test.bats` — create: 6-7 test cases

**Acceptance criteria:**
- [ ] `backup-to-usb.test.bats` has 6-7 cases: full success, mount fail, rsync fail, retention fail, lock acquired, flock contention, missing env var
- [ ] All cases FAIL at this point (RED phase)
- [ ] `bats scripts/tests/backup-to-usb.test.bats` runs without syntax error

**Commit message:**
```
test(deploy): backup-to-usb.test.bats ADD 7 cases for backup-to-usb.sh

RED phase: define full weekly USB backup pipeline. Cases: success,
mount fail (exit 2), rsync fail (exit 3), retention fail (exit 3),
flock acquired, flock contention (silent skip), missing env var (exit 1).
All fail until script is implemented.
```

---

### TASK-011: backup-to-usb.sh (GREEN)

**Type:** TDD-GREEN
**Capability:** deployment-devops
**Depends on:** TASK-010
**Estimated lines:** ~55
**Work unit:** 1 commit

**Description:**
Implement `backup-to-usb.sh` weekly backup pipeline: (1) `flock -n /var/lock/athlos-backup.lock` — non-blocking, skip silently if locked; (2) set `USB_DEVICE=/dev/disk/by-label/athlos-backup-usb`, `USB_KEYFILE=/root/athlos-usb.key`, `USB_MAPPER=athlos-backup-usb`, `USB_MOUNT_POINT=/mnt/athlos-backup-usb`, `BACKUP_DIR` from env; (3) call `mount-usb.sh` — exit 2 on mount fail; (4) run `rsync -av --delete "$BACKUP_DIR/" "$USB_MOUNT_POINT/"` — exit 3 on fail; (5) check USB_RETENTION_DAYS — remove files older than N days in `$USB_MOUNT_POINT`; (6) call `unmount-usb.sh`; (7) `trap cleanup EXIT INT TERM` for unmount on any error path.

**Files:**
- `scripts/backup-to-usb.sh` — create: main script

**Acceptance criteria:**
- [ ] `backup-to-usb.sh` is created AFTER `backup-to-usb.test.bats`
- [ ] All cases from TASK-010 now PASS
- [ ] `flock -n /var/lock/athlos-backup.lock` at start (non-blocking silent skip)
- [ ] `trap cleanup EXIT INT TERM` for unmount on any error path
- [ ] rsync uses `-av --delete` and respects `BACKUP_DIR` env var
- [ ] Retention removes files older than `USB_RETENTION_DAYS` (default 30)

**Commit message:**
```
feat(deploy): backup-to-usb.sh ADD weekly USB backup pipeline

GREEN phase: full USB backup pipeline. Non-blocking flock at start,
mount via mount-usb.sh, rsync -av --delete, retention enforcement
(USB_RETENTION_DAYS, default 30), unmount via unmount-usb.sh.
trap cleanup on EXIT/INT/TERM. Exit 2=mount fail, 3=rsync/retention fail.
```

---

### TASK-012: REFACTOR backup-to-usb.sh

**Type:** TDD-REFACTOR
**Capability:** deployment-devops
**Depends on:** TASK-011
**Estimated lines:** varies
**Work unit:** 1 commit

**Description:**
Review `backup-to-usb.sh` for deduplication, clearer logging, consistent error handling, `set -e`/`set -u` guards. No behavior change.

**Files:**
- `scripts/backup-to-usb.sh` — modify: refactor

**Acceptance criteria:**
- [ ] All bats tests still pass — `bats scripts/tests/backup-to-usb.test.bats`
- [ ] Error messages are clear and consistent
- [ ] No behavior change from TASK-011
- [ ] `shellcheck scripts/backup-to-usb.sh` — clean

**Commit message:**
```
refactor(deploy): backup-to-usb.sh improve logging and error guards

Add set -e/set -u, clarify logging, consistent error messages.
No behavior change — all bats tests still pass.
```

---

### TASK-013: setup-usb.test.bats (RED)

**Type:** TDD-RED
**Capability:** deployment-devops
**Depends on:** TASK-005 (so `mount-usb.sh` is callable for verify)
**Estimated lines:** ~20
**Work unit:** 1 commit

**Description:**
Write 3-4 failing bats test cases for `setup-usb.sh`: (1) `--help` prints usage and exits 0; (2) `--dry-run --device /dev/sdc1` prints plan without formatting, exits 0; (3) missing required args → exit 1; (4) `--device` not present → exit 2. NOTE: do NOT test actual LUKS format — use mocks/dry-run only for RED phase.

**Files:**
- `scripts/tests/setup-usb.test.bats` — create: 3-4 test cases

**Acceptance criteria:**
- [ ] `setup-usb.test.bats` has 3-4 cases: --help, --dry-run, missing args, device not present
- [ ] All cases FAIL at this point (RED phase)
- [ ] `bats scripts/tests/setup-usb.test.bats` runs without syntax error

**Commit message:**
```
test(deploy): setup-usb.test.bats ADD cases for setup-usb.sh

RED phase: define expected behavior. Cases: --help prints usage,
--dry-run prints plan without formatting, missing args exit 1,
device not present exit 2. Dry-run only — no actual LUKS format.
```

---

### TASK-014: setup-usb.sh (GREEN)

**Type:** TDD-GREEN
**Capability:** deployment-devops
**Depends on:** TASK-013
**Estimated lines:** ~30
**Work unit:** 1 commit

**Description:**
Implement `setup-usb.sh` as a manual one-shot setup script for a fresh USB drive: (1) parse `--device` and `--help` flags; (2) verify running as root; (3) require operator to type literal `YES` to confirm destructive format; (4) `--dry-run` prints the plan (LUKS format command, ext4 mkfs, keyfile creation) without executing; (5) full run: `cryptsetup luksFormat`, `cryptsetup open`, `mkfs.ext4`, create keyfile at `/root/athlos-usb.key` chmod 0600 root:root. Scope is LUKS + ext4 + keyfile preconditions only — leave disk ready, runbook documents verify step.

**Files:**
- `scripts/setup-usb.sh` — create: main script

**Acceptance criteria:**
- [ ] `setup-usb.sh` is created AFTER `setup-usb.test.bats`
- [ ] All cases from TASK-013 now PASS
- [ ] Requires operator to type literal `YES` to confirm format (defense in depth)
- [ ] `bash scripts/setup-usb.sh --help` — prints usage, exits 0
- [ ] `bash scripts/setup-usb.sh --dry-run --device /dev/sdc1` — prints plan, no format

**Commit message:**
```
feat(deploy): setup-usb.sh ADD USB LUKS+ext4 one-shot setup script

GREEN phase: manual one-shot USB setup. Requires --device flag.
Dry-run mode prints plan. Production mode: luksFormat, open, mkfs.ext4,
keyfile creation at /root/athlos-usb.key (0600 root:root). Defense in depth:
requires operator to type YES to confirm. Leaves disk ready.
```

---

### TASK-015: REFACTOR setup-usb.sh

**Type:** TDD-REFACTOR
**Capability:** deployment-devops
**Depends on:** TASK-014
**Estimated lines:** varies
**Work unit:** 1 commit

**Description:**
Review `setup-usb.sh` for clarity, add doc comments, improve usage text, consistent error handling. No behavior change.

**Files:**
- `scripts/setup-usb.sh` — modify: refactor

**Acceptance criteria:**
- [ ] All bats tests still pass — `bats scripts/tests/setup-usb.test.bats`
- [ ] Usage text is clear and complete
- [ ] No behavior change from TASK-014
- [ ] `shellcheck scripts/setup-usb.sh` — clean

**Commit message:**
```
refactor(deploy): setup-usb.sh improve usage text and error handling

Polish usage text, add doc comments, consistent error handling.
No behavior change — all bats tests still pass.
```

---

### TASK-016: .env.example add 5 vars

**Type:** config
**Capability:** cross-cutting
**Depends on:** TASK-005 (USB paths defined by mount-usb.sh)
**Estimated lines:** +5
**Work unit:** 1 commit

**Description:**
Add 5 USB rotation environment variables to `.env.example`: `USB_DEVICE=/dev/disk/by-label/athlos-backup-usb`, `USB_KEYFILE=/root/athlos-usb.key`, `USB_MAPPER=athlos-backup-usb`, `USB_MOUNT_POINT=/mnt/athlos-backup-usb`, `USB_RETENTION_DAYS=30`. Add them near existing backup-related entries.

**Files:**
- `.env.example` — modify: ADD 5 USB vars

**Acceptance criteria:**
- [ ] `grep -c "USB_DEVICE" .env.example` ≥ 1
- [ ] `grep -c "USB_KEYFILE" .env.example` ≥ 1
- [ ] `grep -c "USB_MAPPER" .env.example` ≥ 1
- [ ] `grep -c "USB_MOUNT_POINT" .env.example` ≥ 1
- [ ] `grep -c "USB_RETENTION_DAYS" .env.example` ≥ 1
- [ ] All vars have sensible defaults or are documented as root-only

**Commit message:**
```
chore(env): .env.example ADD USB rotation variables

Add 5 env vars for USB backup rotation: USB_DEVICE, USB_KEYFILE,
USB_MAPPER, USB_MOUNT_POINT, USB_RETENTION_DAYS (default 30).
```

---

### TASK-017: docs/runbook.md add USB Rotation section

**Type:** docs
**Capability:** cross-cutting
**Depends on:** none (independent)
**Estimated lines:** ~15 net
**Work unit:** 1 commit

**Description:**
Add a USB Rotation section to `docs/runbook.md` covering: (1) Prerequisites — USB drive already set up via `setup-usb.sh`, LUKS keyfile at `/root/athlos-usb.key`; (2) Weekly rotation — how to run `backup-to-usb.sh` manually or via cron (Sunday 4 AM), cron line to add; (3) Verify — `bash scripts/mount-usb.sh` to check disk visible, `rsync --dry-run` to preview; (4) Troubleshooting — common error codes, how to check LUKS status, how to run `unmount-usb.sh` manually.

**Files:**
- `docs/runbook.md` — modify: ADD USB Rotation section

**Acceptance criteria:**
- [ ] `grep -c "setup-usb.sh" docs/runbook.md` ≥ 1
- [ ] `grep -c "backup-to-usb.sh" docs/runbook.md` ≥ 1
- [ ] `grep -c "cron" docs/runbook.md` ≥ 1 (or Sunday 4 AM mentioned)
- [ ] Section includes troubleshooting for exit codes 1, 2, 3

**Commit message:**
```
docs(runbook): runbook.md ADD USB Rotation operational section

Document prerequisites (setup-usb.sh), weekly rotation via cron
(Sunday 4 AM), verify steps (mount-usb.sh --verify, rsync --dry-run),
and troubleshooting for exit codes 1/2/3.
```

---

### TASK-018: .github/workflows/test.yml extend backup-bats job

**Type:** ci
**Capability:** cross-cutting
**Depends on:** TASK-015 (scripts are final)
**Estimated lines:** ~3 YAML
**Work unit:** 1 commit

**Description:**
Extend the `backup-bats` CI job in `.github/workflows/test.yml` to: (1) add `cryptsetup` and `rsync` to apt install steps; (2) ensure bats tests run `scripts/tests/*.test.bats` including the new USB rotation tests. Do not change job structure — only extend the existing `backup-bats` job.

**Files:**
- `.github/workflows/test.yml` — modify: extend backup-bats job

**Acceptance criteria:**
- [ ] `grep -c "cryptsetup" .github/workflows/test.yml` ≥ 1
- [ ] `grep -c "rsync" .github/workflows/test.yml` ≥ 1
- [ ] `backup-bats` job runs `bats scripts/tests/*.test.bats`
- [ ] Existing job structure unchanged (only apt packages added)

**Commit message:**
```
ci: test.yml extend backup-bats job with cryptsetup rsync apt

Add cryptsetup and rsync to apt install in backup-bats job so
USB rotation bats tests can run in CI. No other structural changes.
```

---

### TASK-019: Pre-closing verification + planning artifacts

**Type:** verify
**Capability:** cross-cutting
**Depends on:** TASK-001..018
**Estimated lines:** 0 (verification only)
**Work unit:** 1 commit

**Description:**
Run all verification checks before the closing release commit. This is the CRITICAL canonical sync self-verify task (B1a LESSON). Commit any planning artifact updates discovered during implementation. Produce `apply-progress.md` with TDD chain results and canonical sync self-verify result.

**Files (modified by verification, not by code changes):**
- `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/apply-progress.md` — create: TDD chain results + canonical sync result

**Acceptance criteria:**
- [ ] `pnpm test:run` — 464 tests pass (no regression)
- [ ] `shellcheck scripts/**/*.sh` — clean
- [ ] **CANONICAL SYNC SELF-VERIFY (B1a LESSON):** Run this command and the diff MUST be empty:
  ```bash
  diff <(grep -A 200 "USB Rotation" openspec/specs/deployment-devops/spec.md | head -50) \
       <(grep -A 200 "USB Rotation" openspec/changes/athlos-deploy-slice-b1b-usb-rotation/specs/deployment-devops/spec.md | head -50)
  ```
  If not empty, the apply phase has FAILED the canonical sync — fix it before continuing.
- [ ] `grep -c "USB_DEVICE" .env.example` ≥ 1
- [ ] `grep -c "setup-usb.sh" docs/runbook.md` ≥ 1
- [ ] `grep -c "cryptsetup" .github/workflows/test.yml` ≥ 1
- [ ] `bats scripts/tests/common.test.bats` — all PASS
- [ ] `bats scripts/tests/mount-usb.test.bats` — all PASS
- [ ] `bats scripts/tests/unmount-usb.test.bats` — all PASS
- [ ] `bats scripts/tests/backup-to-usb.test.bats` — all PASS
- [ ] `bats scripts/tests/setup-usb.test.bats` — all PASS
- [ ] `apply-progress.md` ends with canonical sync self-verify result (empty diff)

**Commit message:**
```
chore(verify): pre-closing verification — all tests pass, canonical sync OK

Run full verification suite: pnpm test:run (464 tests), shellcheck,
bats all PASS, and CRITICAL canonical sync self-verify (empty diff).
Commit apply-progress.md with results.
```

---

### TASK-020: Closing commit: v0.4.3 → v0.4.4 + CHANGELOG

**Type:** release
**Capability:** cross-cutting
**Depends on:** TASK-019
**Estimated lines:** ~10
**Work unit:** 1 commit

**Description:**
Version bump `package.json` from `0.4.3` to `0.4.4` and add `[0.4.4]` entry to CHANGELOG.md. This is the closing commit of the single PR — follows Slice A/B0/B1a precedent. Do NOT edit CHANGELOG.md during the PR (TASK-020 only).

**Files:**
- `package.json` — modify: `"version": "0.4.3"` → `"version": "0.4.4"`
- `CHANGELOG.md` — modify: ADD `[0.4.4]` entry with USB Rotation summary

**Acceptance criteria:**
- [ ] `git show HEAD~1:package.json | grep version` = `0.4.3`
- [ ] `git show HEAD:package.json | grep version` = `0.4.4`
- [ ] CHANGELOG.md has a `[0.4.4]` entry describing USB Rotation
- [ ] No other files changed in this commit
- [ ] This is the final commit of the PR

**Commit message:**
```
chore(release): v0.4.4

[0.4.4] — USB Rotation (Slice B1b)
- feat(deploy): USB backup rotation scripts (mount, unmount, backup-to-usb, setup-usb)
- feat(deploy): common.sh extended with require_root, is_mounted, is_luks_open
- chore(env): .env.example USB rotation variables
- docs(runbook): USB Rotation operational section
- ci: test.yml backup-bats job extended with cryptsetup rsync
```

---

## Section 3: Dependencies (Visual)

```
TASK-001 → TASK-002 → TASK-003
                          ↓
                        TASK-004 → TASK-005 → TASK-006
                                                    ↓
                                                  TASK-007 → TASK-008 → TASK-009
                                                                              ↓
                                                                            TASK-010 → TASK-011 → TASK-012
                                                                                                    ↓
                                                                                                  TASK-013 → TASK-014 → TASK-015
                                                                                                                                  ↓
TASK-016 (config) ────────────────────────────────────────────────────────────────→ TASK-019
TASK-017 (docs, independent) ────────────────────────────────────────────────────→ TASK-019
TASK-018 (CI, after TASK-015) ──────────────────────────────────────────────────→ TASK-019
                                                                          ↓
                                                                        TASK-020 (release)
```

---

## Section 4: Strict TDD Verification Checklist (CRITICAL)

For TASK-001 (common extend RED):
- [ ] `common.test.bats` has at least 3 NEW cases: `require_root` exits 1 if not root, `is_mounted` returns true/false correctly, `is_luks_open` returns true/false correctly
- [ ] All NEW cases FAIL at this point (B1a cases should still pass)

For TASK-002 (common extend GREEN):
- [ ] `common.sh` is extended AFTER `common.test.bats`
- [ ] All NEW cases PASS
- [ ] B1a cases still pass (no regression)

For TASK-004 (mount-usb RED):
- [ ] `mount-usb.test.bats` has 5 cases: success, wrong keyfile perms → exit 1, USB not present → exit 2, already mounted → exit 0 idempotent, missing env var → exit 1
- [ ] All cases FAIL

For TASK-005 (mount-usb GREEN):
- [ ] `mount-usb.sh` AFTER `mount-usb.test.bats`
- [ ] All cases PASS
- [ ] Keyfile perms check via `stat -c '%a'` + `stat -c '%U:%G'` BEFORE `cryptsetup open`
- [ ] `trap cleanup EXIT INT TERM` for unmount on error path

For TASK-007 (unmount-usb RED):
- [ ] `unmount-usb.test.bats` has 3-4 cases: success, not mounted → exit 0 silent, LUKS not open → skip close, missing env var → exit 1
- [ ] All cases FAIL

For TASK-008 (unmount-usb GREEN):
- [ ] `unmount-usb.sh` AFTER `unmount-usb.test.bats`
- [ ] All cases PASS
- [ ] `umount` BEFORE `cryptsetup close` (order matters!)

For TASK-010 (backup-to-usb RED):
- [ ] `backup-to-usb.test.bats` has 6-7 cases: full pipeline success, mount fails → exit 2, rsync fails → exit 3, retention fails → exit 3, concurrency lock acquired, flock contention → exit 0 silent, env var missing → exit 1
- [ ] All cases FAIL

For TASK-011 (backup-to-usb GREEN):
- [ ] `backup-to-usb.sh` AFTER `backup-to-usb.test.bats`
- [ ] All cases PASS
- [ ] `flock -n /var/lock/athlos-backup.lock` at start (non-blocking silent skip)
- [ ] `trap cleanup EXIT INT TERM` for unmount on any error path

For TASK-013 (setup-usb RED):
- [ ] `setup-usb.test.bats` has 3-4 cases: --help prints usage, --dry-run prints plan, missing args → exit 1, --device not present → exit 2
- [ ] All cases FAIL (do NOT actually test LUKS format; use --dry-run only)

For TASK-014 (setup-usb GREEN):
- [ ] `setup-usb.sh` AFTER `setup-usb.test.bats`
- [ ] All cases PASS
- [ ] Requires operator to type literal `YES` to confirm format (defense in depth)

For TASK-003 / TASK-006 / TASK-009 / TASK-012 / TASK-015 (REFACTOR):
- [ ] Code dedup, naming improvements
- [ ] All bats tests still pass
- [ ] No behavior change

---

## Section 5: CRITICAL B1a LESSON — Canonical Sync Self-Verify in TASK-019

**THIS SECTION IS MANDATORY. DO NOT SKIP.**

B1a revealed that MODIFIED canonical sync is a recurring gap. The canonical spec at `openspec/specs/deployment-devops/spec.md` was not properly synced with the change spec during apply. This MUST NOT recur in B1b.

**TASK-019 is the most important verification task.** It includes an ATOMIC canonical sync self-verify:

```bash
diff <(grep -A 200 "USB Rotation" openspec/specs/deployment-devops/spec.md | head -50) \
     <(grep -A 200 "USB Rotation" openspec/changes/athlos-deploy-slice-b1b-usb-rotation/specs/deployment-devops/spec.md | head -50)
```

This diff MUST be empty before the release commit (TASK-020) is created. If it is NOT empty:
1. The apply phase has FAILED the canonical sync
2. Fix the discrepancy immediately
3. Re-run the diff until it is empty
4. Document the fix in `apply-progress.md`

The orchestrator MUST instruct `sdd-apply` sub-agent to perform this self-verify atomically in TASK-019.

---

## Section 6: Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~353 (40+20+55+30 scripts + 20 common.sh + 40+25+55+20 bats + 5 .env + 15 docs + 3 YAML + 1 spec delta) |
| 400-line budget risk | **LOW** (~88%) |
| Chained PRs recommended | **No** |
| Suggested split | N/A |
| 2-commit structure | TDD (TASK-001..019) + release (TASK-020) in single PR |
| Work-unit count | 20 (1 per task) |

**Decision needed before apply:** No
**Chained PRs recommended:** No
**Chain strategy:** single-pr
**400-line budget risk:** Low

---

## Section 7: Out of Scope (Re-affirm)

- **Slice B1a changes** — already shipped at v0.4.3, frozen
- **Slice C/D entirely** (Dockerfile, entrypoint, compose, CI deploy workflow, `db-destructive` label gate) — separate future changes
- **AWS S3 / cloud backups** — rejected by ADR #30
- **`pg_basebackup` / WAL archiving / PITR** — much larger future slice
- **`restore-drill.sh`** — separate future change per Server Infra §8
- **systemd timers** — defer to v2
- **Cockpit alerting on backup failures** — defer
- **Samba / Nextcloud / AD** — completely separate future changes (ADR #33)
- **Storage volume tar** — defer to v2
- **logrotate snippet** — deferred per B1a
- **Auto-failover to local backup if USB fails** — manual fallback per runbook
- **Cross-region / offsite-cloud secondary** — not applicable (self-hosted)

---

## Section 8: Pre-apply Checklist for Orchestrator (B1a LESSON EMPHASIZED)

- [ ] Branch `feat/athlos-deploy-slice-b1b-usb-rotation` created from `origin/main`
- [ ] All 20 tasks in `tasks.md` present
- [ ] `sdd-apply` sub-agent receives this file + the proposal/spec/design paths
- [ ] Strict TDD enabled is forwarded in the apply prompt
- [ ] **CRITICAL:** Apply prompt explicitly instructs apply to self-verify canonical sync atomically in TASK-019 (B1a lesson)
- [ ] Closing commit verification: orchestrator runs `git show HEAD~1 -- package.json | grep version` vs `git show HEAD -- package.json | grep version` after apply
- [ ] Lesson from Slice A/B0/B1a: orchestrator MUST plan for apply gaps (planning artifacts, lockfile, MODIFIED canonical sync) and instruct apply to commit them; verify must catch them; archive must sync the canonical MODIFIED spec
