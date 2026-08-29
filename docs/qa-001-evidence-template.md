# QA-001 Collections terminal evidence

Use this template only after a live BETA run. Automated checks support the decision but never complete
Collections or release the exclusive P0 gate. Record sanitized references, ranges, and outcomes only: do
not include credentials, approval tokens, names, member identifiers, contact details, or raw financial data.

## Completion rule

The gate is **blocked** unless every field below is present, the revision and environment/candidate match
the release candidate, rollback evidence is recorded, and an explicitly `human` acceptor records
affirmative sign-off. Missing, unknown, bot, automated, service, or test provenance is a no-go, even
with affirmative sign-off. Pending, partial, stale, or mismatched evidence is also a no-go.

## Sanitized evidence record

```yaml
revision: <immutable revision>
environment: { id: <non-secret BETA identity>, candidate: <release candidate identity> }
support: { automated: passed }
baseline: { precheck: <classification>, postcheck: <classification> }
assessment:
  { expectedRange: <sanitized range>, actualRange: <sanitized range>, replay: <no duplicates> }
payment: { full: passed, tender: CASH, physicalCash: matched }
reversal: { exact: passed }
treatments:
  payment: <result>
  communityWork: <result>
  agreement: <debt-neutral result>
  condonation: <approved exact-once result>
approvals: { request: inert, rejection: inert, condonation: exactly-once }
rollback: { evidence: <exact reversal or no-effect rollback reference> }
acceptance: { acceptingUser: <sanitized role/reference>, acceptorType: human, signOff: affirmative }
```

## Required live checks

1. Confirm bounded baseline/post-check and expected versus actual assessment range; replay once and show
   no duplicate obligations.
2. Confirm one full payment with physical `CASH` CashDesk evidence, then an exact reversal.
3. Record the four separate treatment behaviors. Request and rejection remain inert; approved condonation
   executes exactly once.
4. Record cleanup/rollback evidence. Keep CTActe disabled and do not cross club boundaries.
5. A human acceptor records `acceptorType: human` and `signOff: affirmative`. Do not record a name; use a
   sanitized role/reference. Bot, automated, service, test, unknown, or missing provenance keeps
   Collections incomplete and the exclusive P0 gate blocked.

## Recovery

Stop on any missing or failed field. Preserve the sanitized record. Correct financial facts only through
the supported exact reversal; never edit ledgers directly. This template does not authorize a live run.
