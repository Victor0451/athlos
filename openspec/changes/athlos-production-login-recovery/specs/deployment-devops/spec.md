# Delta for Deployment/DevOps

## ADDED Requirements

### Requirement: Recovery Authorization, Abort, and Evidence

Planning/apply SHALL change repository artifacts only. Without later explicit operational authorization, they MUST NOT migrate, bootstrap, deploy, restart, mutate secrets, or write production DB. Failed gates SHALL abort with redacted evidence; repository slices MUST be reversible.

#### Scenario: Authorization is absent
- GIVEN recovery is prepared but approval is absent
- WHEN apply is invoked
- THEN it MUST stop before every live operational action

#### Scenario: A recovery gate fails
- GIVEN a backup, rehearsal, schema, or validation gate fails
- WHEN the procedure evaluates it
- THEN it MUST abort and preserve the failure evidence and rollback decision

### Requirement: PR2 Parallel-Delivery Isolation

PR2 SHALL use its own worktree, branch, candidate, and owner. It MUST NOT share staging or mix recovery scope; each unit MUST remain within 400 lines.

#### Scenario: Mixed candidate is proposed
- GIVEN a candidate contains PR2 and recovery changes
- WHEN delivery review runs
- THEN it MUST reject the candidate until scopes are separated
