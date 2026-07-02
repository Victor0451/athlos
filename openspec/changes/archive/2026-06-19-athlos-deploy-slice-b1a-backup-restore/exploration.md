# Exploration: athlos-deploy-slice-b1-scoping

**Date:** 2026-06-19
**Mode:** Standalone exploration (Slice B1 has not been named as a change yet).
**Parent roadmap:** `openspec/changes/data-steward-grant-automation/archive/2026-06-18/exploration.md`
(Slice B parent exploration — the file currently inside the B0 archive folder).
**Locked decisions source:** `/run/media/vlongo/Archivos/obsidian/Projectos/Athlos/2-Architecture/5-Server-Infrastructure.md`
(Server Infrastructure doc, created 2026-06-19, ADRs #28-#33).
**Verdict:** Slice B1 is larger than the original 320 LoC estimate because (a) the
parent exploration assumed S3, but the Server Infrastructure doc locks local + USB
rotation; (b) USB rotation adds 3 new scripts (`mount-usb.sh`, `unmount-usb.sh`,
`backup-to-usb.sh`); (c) the S3→local pivot requires MODIFIED specs on two
capabilities (`deployment-devops`, `database-migrations`). Realistic PR LoC is
~570-790 (excluding planning artifacts), which **exceeds the 400-line review
budget**. Recommend **chained PRs** (B1a core + B1b USB).

---

## 1. Infrastructure context (locked ADRs)

| Decision | Locked value | ADR | Implication for Slice B1 |
|----------|-------------|-----|--------------------------|
| OS | Ubuntu Server 24.04 LTS | #29 | bash + cron, no PowerShell/Task Scheduler |
| Backup storage | local disk + external USB rotation (no S3, no cloud) | #30 | Drop all S3/AWS CLI deps from the original Slice B plan |
| Encryption | LUKS on USB disk only | #31 | system disk + local backup disk are unencrypted; USB is LUKS-protected |
| Restore | assisted CLI with `--confirm` mandatory | #32 | Never auto-restore; banner + explicit confirmation gate |
| Apps adicionales | Samba/Nextcloud/AD are separate future changes | #33 | Do NOT scope-creep Slice B1; those are post-B1 changes |

### Spec-vs-infra conflicts to resolve in Slice B1

The existing OpenSpec mandates **S3** in two places:

- `openspec/specs/deployment-devops/spec.md:165-196` — Backup Strategy. Uses neutral
  phrasing ("volume or object storage") → no change required, only path adjustment
  for `s3://...` references.
- `openspec/specs/database-migrations/spec.md:65-70` — Pre-migration backup mandates
  `s3://athlos-backups/pre-deploy-<sha>.sql.gz`. **This MUST be modified** to reflect
  the local+USB reality. Slice D (CI deploy workflow + `db-destructive` label gate)
  will pick up the modified wording when it lands.
- `openspec/specs/file-storage/spec.md:525-529` — `scripts/backup.sh` SHOULD tar the
  `storage` volume at `/backups/storage-{timestamp}.tar.gz`. The `storage` named
  volume is itself not yet implemented (Slice A exploration flagged this). **Defer to v2.**
  Slice B1 explicitly does NOT touch file storage; the spec scenario stays valid as
  future work.

### Schedule (from §8 of the Server Infrastructure doc)

| Job | Frequency | When | Storage | Retention |
|-----|-----------|------|---------|-----------|
| Daily DB backup | cron `0 3 * * *` | 3 AM local | `/var/backups/athlos/` | 7 days |
| Weekly USB rotation | cron `0 4 * * 0` | Sunday 4 AM | `/mnt/athlos-backup-usb/` (LUKS) | 30 days |

Both run as the `admin` user via `/etc/cron.d/athlos-backup`. No containers involved.

---

## 2. Reusable surface in the repo (no new code dependencies)

| Asset | Path | Reuse for B1 |
|-------|------|--------------|
| Bash CI guard pattern | `apps/api/scripts/ci-check-audit-fp.sh:1-43` | `set -euo pipefail`, documented exit codes, env-header comment block, idempotent checks |
| Bash negative-test pattern | `apps/api/scripts/test-ci-guard-negative.sh:1-51` | How to write a destructive test that mutates a temp copy and restores |
| `pg_dump` binary | Ubuntu package `postgresql-client` (apt-installed via Server Infra §6.D) | No new dep — `pg_dump` ships with `postgresql-client` |
| `gunzip -t` integrity check | Ubuntu coreutils | Cheap verification of compressed dumps |
| `.env.example` shape | `.env.example:1-42` (42 lines, sections with `───` separators) | Append new `─── Backup & Restore (PR Slice B1) ───` block |
| `docs/runbook.md` style | 101 lines, fenced code blocks, deprecation banner mirrors Slice A pattern (line 28) | Add "Backup & Restore" + "USB Rotation" subsections |

**Key insight:** Slice B1 needs zero new TypeScript code. It is a pure bash +
`pg_dump` + `cryptsetup` + `rsync` exercise. The only Engram/OpenSpec coupling is
the `database-migrations` spec delta (S3→local) and a minor `deployment-devops`
spec delta (storage path shape).

---

## 3. Decisions (locked for proposal phase)

### 3.1 Script list and language

| Script | Path | Lang | Shebang | LoC |
|--------|------|------|---------|-----|
| `backup.sh` | `scripts/backup.sh` | bash | `#!/usr/bin/env bash` | ~80 |
| `restore.sh` | `scripts/restore.sh` | bash | `#!/usr/bin/env bash` | ~80 |
| `backup-to-usb.sh` | `scripts/backup-to-usb.sh` | bash | `#!/usr/bin/env bash` | ~50 |
| `mount-usb.sh` | `scripts/mount-usb.sh` | bash | `#!/usr/bin/env bash` | ~40 |
| `unmount-usb.sh` | `scripts/unmount-usb.sh` | bash | `#!/usr/bin/env bash` | ~20 |
| `lib/common.sh` | `scripts/lib/common.sh` | bash | sourced, no shebang | ~40 |
| `tests/backup.test.bats` | `scripts/tests/backup.test.bats` | bats | n/a | ~80 |
| `tests/restore.test.bats` | `scripts/tests/restore.test.bats` | bats | n/a | ~80 |
| `tests/mount-usb.test.bats` | `scripts/tests/mount-usb.test.bats` | bats | n/a | ~40 |
| `tests/backup-to-usb.test.bats` | `scripts/tests/backup-to-usb.test.bats` | bats | n/a | ~60 |
| `.env.example` (additions) | `.env.example` | env | n/a | ~20 |
| `docs/runbook.md` (additions) | `docs/runbook.md` | md | n/a | ~30 |
| `openspec/specs/deployment-devops/spec.md` (delta) | delta spec | md | n/a | ~25 |
| `openspec/specs/database-migrations/spec.md` (delta) | delta spec | md | n/a | ~15 |

**Test framework:** **bats-core** (Bash Automated Testing System). Justification:
- Standard on Ubuntu (`apt install bats`); no install-from-source needed.
- Plays well with `set -euo pipefail` and the existing CI guard patterns.
- bats 1.11+ supports `--print-output-on-failure` and TAP output that the project's
  CI already understands.
- `shellspec` and `shelltest` were considered; bats wins on ecosystem maturity and
  Ubuntu availability.

**Shellcheck:** enforce in CI via `shellcheck scripts/**/*.sh` (Ubuntu:
`apt install shellcheck`). Config: default severity, with a top-of-file disable
comment only where strictly required. Lint guard mirrors `apps/api/scripts/ci-check-audit-fp.sh`
pattern — separate `scripts/tests/shellcheck.sh` CI step.

### 3.2 Script conventions (apply to ALL scripts)

- **Shebang:** `#!/usr/bin/env bash` (matches existing `ci-check-audit-fp.sh:1`).
- **Error handling:** `set -euo pipefail` at top (matches existing guard pattern).
- **Exit codes (documented in file header):**
  - `0` — success
  - `1` — validation error (missing env, invalid args)
  - `2` — connection error (DB unreachable, USB device missing)
  - `3` — operation error (pg_dump failed, rsync failed, restore failed)
- **Logging:** plain stderr in human-readable form, prefixed with `[INFO]`,
  `[WARN]`, `[ERROR]`. No syslog, no JSON — bash scripts on cron don't need
  structured logging for v1. Cron will email stderr to `admin` (default Ubuntu
  crontab behavior); document this in the runbook.
- **Idempotency:**
  - `backup.sh`: always appends timestamped filename; running twice creates two
    separate files (correct — daily backups should not collide).
  - `backup.sh` retention sweep: `find "$BACKUP_DIR" -name '*.sql.gz' -mtime +N
    -delete` at end. Idempotent because deletion of non-existent files is a no-op.
  - `mount-usb.sh`: detects if already mounted (`mountpoint -q`) and exits 0
    instead of erroring.
  - `unmount-usb.sh`: detects if not mounted and exits 0 instead of erroring.
  - `restore.sh`: refuses if active connections > 0 (unless `--force-allow-active`);
    running twice on the same file is allowed and produces an idempotent restore
    (`pg_dump` plain SQL uses `CREATE ... IF NOT EXISTS` semantics for most DDL,
    and Drizzle migrations are forward-only — restore is naturally idempotent at
    the SQL level).

### 3.3 USB mount approach

**Decision: fstab `noauto` entry + manual mount script invoked by cron.**

Rationale:
- fstab `noauto` gives the kernel knowledge of the mount without auto-mounting on
  boot (USB disk may not be plugged at boot).
- Manual mount script is invoked by the weekly cron job — predictable, debuggable,
  fully logged.
- Rejects `udisks2 / udisksctl` auto-mount (too magic, hard to debug when it fails
  silently, depends on desktop stack).
- Rejects `systemd-mount` + `RequiresMountsFor` (couples cron to systemd; cron is
  sufficient and the Server Infra doc already lists cron).
- Rejects Tang server / Clevis (over-engineered for single-node self-hosted v1).

**LUKS key source: keyfile in `/root/athlos-usb.key`** (mode 0600, owner root:root).
This is explicitly named in `5-Server-Infrastructure.md:580` ("requiere passphrase
en `/root/athlos-usb.key`"). Rejected options:
- Interactive passphrase prompt — won't work in cron (no TTY).
- TPM2-bound key — requires `tpm2-tools`; adds complexity for no clear gain on a
  single physical server with admin-only access.

**mount-usb.sh flow:**
1. Source `lib/common.sh`.
2. Validate env vars: `USB_DEVICE`, `USB_MAPPER`, `USB_MOUNT_POINT`, `USB_KEYFILE`.
3. If `mountpoint -q "$USB_MOUNT_POINT"` → already mounted, log `[INFO] already mounted`, exit 0.
4. If `[ ! -b "$USB_DEVICE" ]` → log `[ERROR] USB device $USB_DEVICE not found`, exit 2.
5. `cryptsetup open "$USB_DEVICE" "$USB_MAPPER" --key-file "$USB_KEYFILE"` → exit 2 on failure.
6. `mount "/dev/mapper/$USB_MAPPER" "$USB_MOUNT_POINT"` → exit 2 on failure.
7. Log `[INFO] USB mounted at $USB_MOUNT_POINT`, exit 0.

### 3.4 Cron entry style

**Decision: `/etc/cron.d/athlos-backup` (system-level cron drop-in).**

```
# /etc/cron.d/athlos-backup
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
DATABASE_URL=postgresql://athlos:CHANGE_ME@localhost:5432/athlos
BACKUP_DIR=/var/backups/athlos
BACKUP_RETENTION_DAYS=7
USB_DEVICE=/dev/disk/by-label/athlos-backup-usb
USB_MAPPER=athlos-backup-usb
USB_MOUNT_POINT=/mnt/athlos-backup-usb
USB_KEYFILE=/root/athlos-usb.key
USB_RETENTION_DAYS=30

# Daily 3 AM — local backup
0 3 * * *   admin /opt/athlos-scripts/backup.sh >> /var/log/athlos-backup.log 2>&1

# Weekly Sunday 4 AM — USB rotation
0 4 * * 0   root  /opt/athlos-scripts/backup-to-usb.sh >> /var/log/athlos-backup.log 2>&1
```

Rationale:
- `/etc/cron.d/` is system-level — visible in `/etc`, version-controllable if desired
  (out of scope for B1 but easy to add later via a `cron.d` file in the repo).
- Run-as-user explicit per line (`admin` for daily, `root` for USB because
  `cryptsetup` requires root).
- Log redirected to `/var/log/athlos-backup.log` (rotated by `logrotate`, which
  is already configured per `5-Server-Infrastructure.md:6.K`).

Rejected: `crontab -e` (per-user, hidden from `/etc`, harder to reproduce on a new
server); systemd timers (cleaner but adds setup complexity; defer to v2).

### 3.5 `.env.example` additions (REPLACES the S3 vars from the original Slice B plan)

```bash
# ── Backup & restore (Slice B1) ───────────────────────────────
# Local backup directory (used by backup.sh)
BACKUP_DIR=/var/backups/athlos
# How long to keep daily local backups (days)
BACKUP_RETENTION_DAYS=7

# USB disk for weekly offsite rotation (LUKS-encrypted, mounted on demand)
USB_DEVICE=/dev/disk/by-label/athlos-backup-usb
USB_MAPPER=athlos-backup-usb
USB_MOUNT_POINT=/mnt/athlos-backup-usb
USB_KEYFILE=/root/athlos-usb.key
# How long to keep weekly USB backups (days)
USB_RETENTION_DAYS=30
```

Vars **REMOVED** vs the original Slice B exploration (because S3 is dropped):
`BACKUP_BUCKET`, `BACKUP_BEFORE_MIGRATE`, `S3_ENDPOINT`, `S3_REGION`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. These appear in
`openspec/changes/data-steward-grant-automation/archive/2026-06-18/exploration.md:103-136`
but must NOT be carried forward into Slice B1 — they would be dead config.

**Database URL is already in `.env.example:8`** — `pg_dump` reads it directly, no
new var needed.

### 3.6 Compose integration

**Decision: NO new docker-compose service for Slice B1.** Both backups run on the
HOST (via `/etc/cron.d/athlos-backup`), connecting to Postgres via `DATABASE_URL`
regardless of whether Postgres itself runs on the host or in a container.

Rationale:
- The Server Infrastructure doc (§6.L) explicitly lists backup scripts at
  `/opt/athlos-scripts/backup.sh` — a HOST path.
- Cron on the host is simpler, more transparent, and easier to debug than a
  sidecar cron container.
- A `backup` service in compose would need: a base image with `postgresql-client`
  + `rsync` + `cryptsetup`, a bind mount of `/var/backups`, the same env vars,
  and a cron daemon — ~80 LoC of docker-compose + Dockerfile additions for no
  clear benefit.
- `docker-compose.yml` stays a placeholder for Slice B1 (real prod compose lands
  in Slice C per the roadmap).

### 3.7 Retention logic

**Decision: inline at the END of each backup script.**

- `backup.sh` end: `find "$BACKUP_DIR" -name 'athlos-*.sql.gz' -mtime +${BACKUP_RETENTION_DAYS} -delete`.
- `backup-to-usb.sh` end: same pattern against `$USB_MOUNT_POINT`.

Rationale: self-contained, idempotent, no extra timer / cron job. A separate
`cleanup-backups.sh` script would add another cron entry, another failure surface,
and zero isolation benefit. Rejected: `logrotate`-style (overkill for v1).

### 3.8 Restore script behavior (`restore.sh`)

Argv:
- `--confirm` — REQUIRED. Without it, script prints banner + usage and exits 1.
- `--source <path>` — REQUIRED. Path to `.sql.gz` or `.dump` file.
- `--target <connstring>` — optional override of `DATABASE_URL` (defaults to env).
- `--dry-run` — print what would happen, exit 0, no DB writes.
- `--force-allow-active` — skip the "active connections > 0" guard.

Flow:
1. Parse args, refuse if `--confirm` missing → exit 1.
2. Validate `DATABASE_URL` (or `--target`) — refuse if empty → exit 1.
3. Validate `--source` file exists and is readable → exit 1 if not.
4. If `--dry-run`, print plan + exit 0.
5. Run `gunzip -t <source>` → exit 2 on failure (corrupt dump).
6. Parse DB name from connection string; query `pg_stat_activity` for active
   connections WHERE `datname = $db_name AND state = active`.
7. If count > 0 and `--force-allow-active` not set → refuse with banner → exit 2.
8. Print banner:
   ```
   ╔════════════════════════════════════════════════════════════╗
   ║  RESTORE WARNING                                            ║
   ║  Target DB: <host>:<port>/<dbname>                          ║
   ║  Source:   <path>                                           ║
   ║  Started:  <ts>                                             ║
   ║  This will OVERWRITE all data in the target database.       ║
   ║  --confirm was passed; proceeding.                          ║
   ╚════════════════════════════════════════════════════════════╝
   ```
9. Stream `gunzip -c <source> | psql "$DATABASE_URL"` → exit 3 on failure.
10. Log success → exit 0.

**Safety gates (mandatory):**
- `--confirm` required (no bypass).
- Refuses if active connections > 0 unless `--force-allow-active`.
- Prints banner with target DB host + warning on every invocation.
- Exit codes 0/1/2/3 documented and tested.

---

## 4. Estimated LoC

| Component | LoC |
|-----------|-----|
| `scripts/backup.sh` | ~80 |
| `scripts/restore.sh` | ~80 |
| `scripts/backup-to-usb.sh` | ~50 |
| `scripts/mount-usb.sh` | ~40 |
| `scripts/unmount-usb.sh` | ~20 |
| `scripts/lib/common.sh` | ~40 |
| `scripts/tests/*.test.bats` | ~260 |
| `scripts/tests/shellcheck.sh` (CI guard) | ~25 |
| `.env.example` additions | ~20 |
| `docs/runbook.md` additions | ~30 |
| `openspec/specs/deployment-devops/spec.md` delta | ~25 |
| `openspec/specs/database-migrations/spec.md` delta | ~15 |
| **PR LoC total (B1a + B1b combined)** | **~685** |
| **Planning artifacts (proposal/design/tasks/exploration — NOT in PR)** | ~250 |

**685 LoC across the two PRs is well over the 400-line review cap if shipped as a single PR.** Chained PRs are required.

---

## 5. Slicing recommendation (CHAINED PRs)

### B1a — Core DB backup + restore + env + spec deltas (~440 LoC)

**The first autonomous PR.** Delivers daily local backup + restore + spec updates.
Zero USB, zero LUKS — just `pg_dump` to a local directory.

- **New:** `scripts/backup.sh` (~80) + `scripts/restore.sh` (~80) +
  `scripts/lib/common.sh` (~40) + `scripts/tests/backup.test.bats` (~80) +
  `scripts/tests/restore.test.bats` (~80) + `scripts/tests/shellcheck.sh` (~25)
- **Modify:** `.env.example` — append `BACKUP_DIR`, `BACKUP_RETENTION_DAYS` (~15)
- **Modify:** `docs/runbook.md` — add "Backup" + "Restore" subsections (~25)
- **Delta specs:** `deployment-devops` (path-neutral, ~15 net) +
  `database-migrations` (replace `s3://athlos-backups/...` with
  `BACKUP_DIR/pre-deploy-<sha>.sql.gz`, ~10 net)
- **Modify:** `apps/api/scripts/` — add `ci-check-backup-files-present.sh` (a
  pattern-check CI guard verifying `scripts/backup.sh`, `scripts/restore.sh`,
  and `scripts/lib/common.sh` exist and are executable, ~20L)
- **External deps:** `postgresql-client`, `bats`, `shellcheck` (Ubuntu packages,
  installable via `apt install` — documented in the runbook, not a code dep).

**Estimated LoC: ~440.** Slightly over the 400-line budget; if reviewer load is
a concern, the spec deltas can move to a separate commit on the same PR
(commit 1 = `feat(backup): scripts/backup.sh + scripts/restore.sh + bats tests`,
commit 2 = `docs(deployment-devops): update backup path from S3 to local`).
Strict TDD: bats tests RED first.

### B1b — USB rotation + LUKS mount + weekly backup (~245 LoC)

**Depends on B1a merged.** Adds the USB rotation half of the Server Infra plan.

- **New:** `scripts/mount-usb.sh` (~40) + `scripts/unmount-usb.sh` (~20) +
  `scripts/backup-to-usb.sh` (~50) + `scripts/tests/mount-usb.test.bats` (~40) +
  `scripts/tests/backup-to-usb.test.bats` (~60)
- **Modify:** `.env.example` — append `USB_*` and `USB_RETENTION_DAYS` (~10)
- **Modify:** `docs/runbook.md` — add "USB Rotation" subsection + cron entry
  example (~15)
- **Modify:** `openspec/specs/deployment-devops/spec.md` — add USB rotation
  requirement + scenario (~10 net delta)
- **External deps:** `cryptsetup`, `rsync` (already in standard Ubuntu, but
  documented in the runbook).

**Estimated LoC: ~245.** Under the 400-line budget on its own.

**Why B1a first:** delivers 80% of the value (daily backup + disaster recovery
via restore) without the USB complexity. Operators can rely on the local backup
disk alone while USB rotation is reviewed + merged. The LUKS/cryptsetup surface
is the riskiest part of B1b (it touches the kernel + root privileges); isolating
it in its own PR keeps the blast radius small.

**Why not a single PR:** at ~685 LoC combined, a single PR would force the
reviewer to hold two unrelated concerns (Postgres backup semantics + LUKS mount
semantics) in their head at once. Chained PRs keep each PR review-focused.

---

## 6. External dependencies (Ubuntu packages — NOT npm)

| Package | apt name | Why | Installed via |
|---------|----------|-----|---------------|
| `pg_dump`, `pg_restore` | `postgresql-client` | Backup + restore | `apt install postgresql-client` |
| `bats` | `bats` | Bash test runner | `apt install bats` |
| `shellcheck` | `shellcheck` | Bash linter | `apt install shellcheck` |
| `cryptsetup` | `cryptsetup` | LUKS open/close | `apt install cryptsetup` |
| `rsync` | `rsync` | USB rotation | `apt install rsync` (likely preinstalled) |
| `gunzip`, `find`, `mount`, `mountpoint` | `coreutils`, `util-linux` | Already on every Ubuntu system | (preinstalled) |

None of these are external services (no AWS, no cloud, no SaaS). The Server
Infrastructure doc (`5-Server-Infrastructure.md:312-321`) already lists
`rsync`, `tar`, `zstd` in §6.D essential packages. `postgresql-client`,
`cryptsetup`, `bats`, and `shellcheck` are added to that list when Slice B1
lands.

**Slice B1 adds zero npm packages to any `package.json`.** The repo stays at 18
packages + 4 integration adapters.

---

## 7. CI integration (`.github/workflows/test.yml`)

Add a `backup-bats` job that runs `bats scripts/tests/` after the existing
`test` and `drift-check` jobs. The job needs `postgresql-client`, `bats`, and
`shellcheck` installed via `apt-get` (GitHub Actions `ubuntu-latest` runners
have `sudo`).

Job sketch:
```yaml
backup-bats:
  runs-on: ubuntu-latest
  needs: drift-check
  services:
    postgres:
      image: postgres:16-alpine
      env:
        POSTGRES_USER: athlos
        POSTGRES_PASSWORD: athlos
        POSTGRES_DB: athlos
      ports: ['5432:5432']
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
  env:
    DATABASE_URL: postgresql://athlos:athlos@localhost:5432/athlos
    BACKUP_DIR: /tmp/athlos-backup-test
  steps:
    - uses: actions/checkout@v4
    - name: Install test deps
      run: sudo apt-get install -y bats postgresql-client shellcheck
    - name: Wait for Postgres
      run: |
        for i in {1..30}; do
          pg_isready -h localhost -p 5432 -U athlos && break
          sleep 1
        done
    - name: shellcheck
      run: shellcheck scripts/*.sh scripts/lib/*.sh
    - name: bats
      run: bats scripts/tests/
```

The bats tests use a temp `BACKUP_DIR` (not `/var/backups/athlos`) — no root
needed. They mock LUKS via skip-if-not-root (the `mount-usb.test.bats` skips
the actual `cryptsetup` call when not running as root and only verifies the
script's argument parsing + env validation).

---

## 8. Risks (top 5)

1. **LUKS passphrase / keyfile handling.** If `/root/athlos-usb.key` is readable by
   the wrong user, anyone with shell access can decrypt the USB. **Mitigation:**
   keyfile is created with `chmod 0600` by the setup script (runbook §7 step),
   owned by `root:root`. CI never has this file. The mount script aborts if
   permissions differ from 0600.

2. **Backup during a long-running import job.** `pg_dump` against a DB with an
   active 50K-row insert can take 10× longer and produce inconsistent output
   without `--single-transaction`. **Mitigation:** use `--lock-wait-timeout=30s`
   (matches the parent exploration's recommendation). The script aborts if it
   would block writes; operators can re-run. `--single-transaction` is rejected
   because it would block all writes for the duration of the dump — worse than
   a brief lock-wait failure.

3. **USB disk not plugged or unreadable on Sunday 4 AM.** **Mitigation:**
   `mount-usb.sh` exits 2 with a clear `[ERROR] USB device $USB_DEVICE not found`
   message. The cron daemon emails `admin` (default Ubuntu behavior). Cockpit
   shows the log in the web UI. Document in runbook: "if USB not plugged on
   Sunday, the weekly rotation is skipped — restore from `/var/backups/athlos`
   instead for that week." No alerting integration in v1.

4. **Restore overwrites live data.** **Mitigation:** `--confirm` mandatory +
   active-connections check + banner + exit codes. bats tests cover all
   negative cases (missing `--confirm`, active connections, nonexistent file).

5. **Backup directory fills the disk.** **Mitigation:** retention sweep +
   runbook warning to monitor `df -h /var/backups/athlos`. Add a Cockpit alert
   via future change (out of scope for B1). The `find ... -delete` retention
   sweep is bounded by `BACKUP_RETENTION_DAYS` so worst case is 7 daily backups
   × ~50MB compressed = ~350MB, well within a 500GB backup disk.

### Lesser risks

- **`gunzip -t` passes but restore is corrupt** (rare; gzip CRC is strong enough
  for v1). Full restore-drill is deferred to a future change.
- **Backup script runs while a Drizzle migration is mid-flight.** Drizzle
  acquires a `pg_advisory_lock` (per `database-migrations/spec.md:88-98`) that
  `pg_dump` waits on. Bounded by the 5-minute migration lock timeout.
- **`psql` is needed by `restore.sh`** — same `postgresql-client` package; no
  new dep.
- **`/var/log/athlos-backup.log` grows unbounded** — handled by existing
  `logrotate` config (`5-Server-Infrastructure.md:6.K`); a `logrotate.d`
  snippet is in scope for B1a (~10 lines, listed above).

---

## 9. Out of scope (defer to future changes)

- **Restore drill (`restore-drill.sh`)** — explicitly listed as out-of-scope in
  `5-Server-Infrastructure.md:589-591`. Needs a separate test DB + scheduled drill.
- **S3 cross-region replication** — no longer applicable (S3 dropped).
- **S3 lifecycle policy** — no longer applicable.
- **Multi-database backups** — Athlos is single-DB today.
- **Per-tenant backup partitioning** — multi-tenancy future work.
- **Backup encryption with a passphrase** — LUKS on USB is enough; adds no value.
- **`pg_basebackup` for PITR** — WAL archiving is a much larger slice; defer.
- **Cloud backups (S3, B2, DO Spaces)** — explicitly OUT per ADR #30.
- **Dockerfile real + entrypoint wiring** — Slice C.
- **CI deploy workflow + pre-deploy dump gate (`db-destructive` label)** —
  Slice D. Slice B1 only changes the `database-migrations` spec wording
  (`s3://` → `BACKUP_DIR/pre-deploy-<sha>.sql.gz`); the gate lands in D.
- **Apps adicionales (Samba, Nextcloud, AD)** — separate future changes per
  ADR #33.
- **Storage volume tar** (`file-storage/spec.md:525-529`) — deferred to v2
  (storage volume is itself not yet implemented per Slice A exploration).
- **Cockpit alerting on backup failures** — defer; manual `grep CRON /var/log/syslog`
  is enough for v1.
- **systemd timers instead of cron** — defer; cron is sufficient.

---

## 10. Source-of-truth file index

| Path | What it tells us |
|------|------------------|
| `/run/media/vlongo/Archivos/obsidian/Projectos/Athlos/2-Architecture/5-Server-Infrastructure.md` | Locks ADRs #28-#33 (OS, storage, encryption, restore, apps-out-of-scope). Defines schedule (daily 3 AM + weekly Sunday 4 AM), retention (7d + 30d), keyfile location (`/root/athlos-usb.key`), mount point (`/mnt/athlos-backup-usb`). |
| `openspec/changes/data-steward-grant-automation/archive/2026-06-18/exploration.md:103-136` | The S3 vars that MUST be DROPPED (BACKUP_BUCKET, S3_*, etc.) |
| `openspec/specs/deployment-devops/spec.md:165-196` | Backup Strategy requirement — neutral enough to keep, may need path adjustment for `s3://` references |
| `openspec/specs/database-migrations/spec.md:65-70` | Pre-migration backup mandate — needs MODIFIED delta to replace `s3://athlos-backups/pre-deploy-<sha>.sql.gz` with `BACKUP_DIR/pre-deploy-<sha>.sql.gz` |
| `openspec/specs/file-storage/spec.md:525-529` | Storage volume backup — DEFER (storage volume not implemented) |
| `apps/api/scripts/ci-check-audit-fp.sh:1-43` | Bash CI guard pattern — `set -euo pipefail`, documented exit codes |
| `apps/api/scripts/test-ci-guard-negative.sh:1-51` | Negative-test pattern for bash guards |
| `.env.example:1-42` | Current shape (42 lines, sectioned with `───`); append new section |
| `docs/runbook.md:1-101` | Current state — add "Backup", "Restore", and "USB Rotation" subsections |
| `docker-compose.yml:1-65` | Stays as-is for B1 (real prod compose is Slice C) |
| `.github/workflows/test.yml:1-83` | Add `backup-bats` job |
| `package.json:1-49` | No npm deps added; root `version` bumps at PR close per project convention |

---

## 11. Recommendation

| Question | Answer |
|----------|--------|
| Is Slice B1 >400 LoC? | **Yes — ~685 LoC combined (B1a + B1b).** Chained PRs required. |
| Sub-slice structure | **B1a (core backup + restore + spec deltas, ~440 LoC) + B1b (USB rotation + LUKS, ~245 LoC).** B1a first. |
| First autonomous slice | **B1a — DB backup + restore.** No LUKS, no USB. Smaller blast radius; ~440 LoC (slightly over but reviewable). |
| External deps in B1a? | `postgresql-client`, `bats`, `shellcheck` (Ubuntu packages only). |
| External deps in B1b? | `cryptsetup`, `rsync` (Ubuntu packages only). |
| S3 dropped? | **Yes** — per ADR #30. `.env.example` S3 vars from the original Slice B exploration are NOT carried forward. |
| Spec mods required? | **Yes — 2 MODIFIED deltas:** `deployment-devops` (path shape) + `database-migrations` (S3 → local). |
| Restore drill? | **Out of scope for B1.** Documented as follow-up per the Server Infra doc. |
| Ready for proposal? | **Yes.** Orchestrator should propose B1a as the first change (`athlos-deploy-slice-b1a-backup-restore` or similar), with B1b as the immediate follow-up chained PR. |

### Immediate next step

Propose B1a as the first change:

- **Why B1a first:** delivers daily backup + assisted restore with zero LUKS/USB
  complexity. The spec deltas (S3→local) land in B1a so Slice D (CI deploy
  workflow) can reference the correct path. Reviewers don't need to hold LUKS
  semantics in their head while reviewing `pg_dump` logic.
- **Why B1b second:** adds USB rotation which is the riskiest part (LUKS, root
  privileges, keyfile management). Isolated PR keeps blast radius small and
  allows the operator to validate B1a in production for a week before layering
  USB on top.

After both B1a and B1b land:
- **Slice C** — Dockerfile real + entrypoint + compose prod (~280 LoC).
- **Slice D** — CI deploy workflow + `db-destructive` PR label gate (~250 LoC).

---

## 12. Open questions for the user (defer to proposal phase)

1. **Slice B1 sub-slice structure** — confirm the B1a/B1b chained PR split, or
   attempt a single PR (~685 LoC, well over the 400-line cap; would need an
   explicit `size:exception` ack from the orchestrator)?
2. **Keyfile management** — the Server Infra doc says `/root/athlos-usb.key` is
   the path. Should the runbook include a one-time setup command (`dd if=/dev/urandom
   of=/root/athlos-usb.key bs=64 count=1 && chmod 0600 /root/athlos-usb.key`) or
   is that considered operator knowledge already?
3. **USB device path** — `/dev/disk/by-label/athlos-backup-usb` (label-based,
   robust to `/dev/sdX` renumbering) vs `/dev/sdc1` (literal). Recommend
   by-label; confirm?
4. **`psql` vs `pg_restore`** — `restore.sh` accepts both `.sql.gz` (plain SQL
   produced by `pg_dump --format=plain | gzip`) and `.dump` (custom format
   produced by `pg_dump --format=custom`). Is plain-only sufficient for v1, or
   should we ship custom-format support too? Recommend plain-only for v1
   (matches spec literal `.sql.gz`); add custom-format in v2 if needed.
5. **Logrotate snippet for `/var/log/athlos-backup.log`** — include in B1a (~10
   LoC in `/etc/logrotate.d/athlos-backup`) or defer? Recommend include in B1a;
   it's small and keeps the log from filling the disk.
6. **Test framework** — bats-core is recommended. Confirm, or prefer shellspec /
   shelltest?
7. **B1a scope refinement** — is 440 LoC acceptable for the first chained PR, or
   should spec deltas move to a separate commit on the same PR to keep the
   feature commit smaller?

---

*Persisted to:*
- *`openspec/changes/explore-athlos-deploy-slice-b1-scoping/exploration.md`*
- *Engram topic `sdd/explore/athlos-deploy-slice-b1-scoping`*
