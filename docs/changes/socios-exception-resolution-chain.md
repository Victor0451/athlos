# Socios Exception Resolution Feature Chain

## Scope

This tracker integrates the approved Socios evidence exception-resolution workflow: immutable resolution records, service and persistence boundaries, steward API and UI, reconciliation, authorization, migration-ledger support, and baseline verification.

## Child Order

1. Schema records
2. Service contracts
3. Persistence
4. API
5. Immutable application
6. Reconciliation
7. Reprocess confirmation
8. Web inbox
9. Resolution options
10. Resolution UI
11. Identity fix
12. Application confirmation UI
13. Steward access
14. Verification gaps
15. Migration ledger
16. Baseline tests

## Integration Policy

Children must be reviewed and integrated in order. This tracker PR is draft and must not merge until every child is complete and the final feature branch has passed its verification.

## Verification

Each child retains the tests that verify its work unit. Review each child against its immediate parent branch, keep its changed-line budget at or below 400, and require its GitHub checks before integration.

## Rollback

Hold or revert the affected child work unit before tracker integration. Because the tracker is the only branch targeting `main`, incomplete exception-resolution work cannot reach `main` independently.
