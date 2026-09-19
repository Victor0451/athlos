# QA-001 live BETA run checklist

How to collect the evidence that releases Collections and the exclusive P0 hold.

**Read `docs/qa-001-evidence-template.md` first** — it states the completion rule and the
sanitization policy. This checklist is the operating procedure; the template is the contract.

Nothing here authorizes a live run. Automated checks and simulators support the decision and
never complete it: every Playwright simulator in `apps/web/e2e/` mocks `**/api/v1/**` entirely,
so no simulator has ever exercised the real ledger.

---

## What has to be true before you start

- [ ] BETA is deployed from an **immutable revision** you can name (`git rev-parse HEAD` of the
      deployed tree, or the deployed image/tag). Write it down — it becomes `--revision`.
- [ ] You have **physical cash** available. `payment.physicalCash` must be `matched` against
      CashDesk evidence; a simulated tender cannot produce it.
- [ ] A **human acceptor** is present and will sign. Bot, automated, service, or test provenance
      keeps the gate blocked even with `signOff: affirmative`.
- [ ] CTActe stays **disabled** for the whole run, and the run does not cross club boundaries.
- [ ] You know the **non-secret BETA identity** (`--environment-id`) and the **release candidate
      identity** (`--candidate-id`).

Copy the starting record before editing it, so the pristine example stays in git:

```bash
cp docs/qa-001-evidence.example.json /tmp/qa-001-evidence-live.json
```

---

## The run, in order

Each step names the fields it produces. Fill them into your copy as you go — do not reconstruct
the record from memory afterwards.

### 1. Baseline and assessment

Establish a bounded baseline, run the assessment, then **replay it once**.

| Field                      | Value                                                          |
| -------------------------- | -------------------------------------------------------------- |
| `baseline.precheck`        | the pre-check classification you observed                      |
| `baseline.postcheck`       | the post-check classification you observed                     |
| `assessment.expectedRange` | the sanitized expected range                                   |
| `assessment.actualRange`   | the sanitized actual range                                     |
| `assessment.replay`        | `no duplicates` once the replay shows no duplicate obligations |

The replay is the point of this step: an assessment that produces obligations twice is not
bounded, whatever the ranges looked like.

### 2. Full cash payment, then its exact reversal

One full payment, tendered in physical cash, reconciled against CashDesk. Then reverse **exactly**
that payment.

| Field                  | Value                     |
| ---------------------- | ------------------------- |
| `payment.full`         | must be exactly `passed`  |
| `payment.tender`       | must be exactly `CASH`    |
| `payment.physicalCash` | must be exactly `matched` |
| `reversal.exact`       | must be exactly `passed`  |

`support.automated` must be exactly `passed` — the automated suite supporting this run.

### 3. The four treatments, separately

These are four distinct behaviours, not four runs of the same thing.

| Field                      | What it must show                                        |
| -------------------------- | -------------------------------------------------------- |
| `treatments.payment`       | the payment treatment applied                            |
| `treatments.communityWork` | community work applied                                   |
| `treatments.agreement`     | **debt-neutral** — an agreement must not change the debt |
| `treatments.condonation`   | an **approved** condonation executed **exactly once**    |

### 4. Approvals

| Field                   | What it must show                                    |
| ----------------------- | ---------------------------------------------------- |
| `approvals.request`     | `inert` — requesting approval changes nothing        |
| `approvals.rejection`   | `inert` — a rejection changes nothing                |
| `approvals.condonation` | `exactly-once` — approval executes once, never twice |

Request and rejection being inert is the actual assertion. A request that moves money is a defect.

### 5. Rollback / cleanup

| Field               | Value                                                          |
| ------------------- | -------------------------------------------------------------- |
| `rollback.evidence` | an exact reversal reference, or a no-effect rollback reference |

Correct financial facts **only** through the supported exact reversal. Never edit a ledger
directly, and never edit this record to make it pass.

### 6. Acceptance — last, and only by a human

| Field                      | Value                                          |
| -------------------------- | ---------------------------------------------- |
| `acceptance.acceptingUser` | a **sanitized role or reference** — not a name |
| `acceptance.acceptorType`  | must be exactly `human`                        |
| `acceptance.signOff`       | must be exactly `affirmative`                  |

Sign this only after steps 1–5 are recorded. Signing earlier and filling in later produces a
record that looks complete and means nothing.

---

## Verifying

```bash
pnpm --filter @athlos/api qa001:verify /tmp/qa-001-evidence-live.json \
  --revision <immutable revision> \
  --environment-id <non-secret BETA identity> \
  --candidate-id <release candidate identity>
```

Exit `0` means released, `1` means blocked with every reason printed, `2` means the arguments or
the file were unusable and the gate never ran.

**The candidate identity must come from those flags, never from the evidence file.** The gate
compares `revision`, `environment.id` and `environment.candidate` against the candidate; reading
both sides from one file would compare the evidence against itself and make those checks vacuous.
The verifier refuses to run without all three flags for exactly this reason.

### Expect to iterate

The gate short-circuits inside `baseline`, `assessment`, `treatments` and `approvals`: it uses
`keys.every(...)`, which stops at the first failing field. So a fully `pending` record reports
**16** reasons, not all 24 fields — `postcheck`, `actualRange`, `replay`, `communityWork`,
`agreement`, `condonation` and `rejection` stay hidden behind the first unmet field of their
group. Fix what is reported, re-run, repeat. This is a property of the gate, pinned by
`apps/api/src/scripts/qa-001-verify.test.ts` so it cannot change silently.

### Do not add keys

Each object must carry **exactly** the keys in the example. An extra or missing key fails as
`has unknown or partial fields` even when every value is correct — including a well-meaning
`$comment` or `_note`. Keep annotations in this file or the template, never in the JSON.

---

## Field reference

**Fixed values the gate requires verbatim** — anything else blocks:

| Field                     | Required      |
| ------------------------- | ------------- |
| `support.automated`       | `passed`      |
| `payment.full`            | `passed`      |
| `payment.tender`          | `CASH`        |
| `payment.physicalCash`    | `matched`     |
| `reversal.exact`          | `passed`      |
| `acceptance.acceptorType` | `human`       |
| `acceptance.signOff`      | `affirmative` |

**Must equal the candidate supplied on the command line:** `revision`, `environment.id`,
`environment.candidate`.

**Descriptive — any non-empty string that is not a placeholder.** The gate rejects
`pending`, `unknown`, `partial` and `not run`, case-insensitively:

`baseline.precheck` · `baseline.postcheck` · `assessment.expectedRange` · `assessment.actualRange` ·
`assessment.replay` · `treatments.payment` · `treatments.communityWork` · `treatments.agreement` ·
`treatments.condonation` · `approvals.request` · `approvals.rejection` · `approvals.condonation` ·
`rollback.evidence` · `acceptance.acceptingUser`

That is 24 fields in total: 7 fixed, 3 identity-bound, 14 descriptive.

The template suggests conventions for the descriptive ones (`inert`, `exactly-once`,
`debt-neutral`, `no duplicates`, `supported`). Following them keeps records comparable across
runs; the gate itself only insists that they are real.

---

## Sanitization

Record sanitized references, ranges, classifications and outcomes only. Never put credentials,
approval tokens, names, member identifiers, contact details, or raw financial data into the
evidence file — it is meant to be committed.

## If something fails mid-run

Stop. Preserve the record as it stands, including what is still `pending`. A partially filled
record that honestly shows the gap is worth more than a completed one that guesses. Correct
financial facts only through the supported exact reversal.

## After a released verdict

Commit the signed evidence record, and record the acceptance against
[issue #371](https://github.com/Victor0451/athlos/issues/371). The verifier prints a released
verdict about the _record_; the acceptor is whoever signed it, and that person owns the decision.
