# Collections Completion Delivery Chain

Tracks delivery for [issue #371](https://github.com/Victor0451/athlos/issues/371).

- **Status:** code delivered to `main` in seven sequential slices; **QA-001 acceptance outstanding**.
- **Target outcome:** the completed Collections capability represented by this immutable feature chain.
- **Child policy:** each child branch is reviewed only against its immediate predecessor; the tracker remains the integration target.
- **QA-001:** the chain is complete, so this is now the **only** remaining hold. Collections is finished in code but not accepted. See `docs/qa-001-run-checklist.md` for the live BETA procedure and `apps/api/src/scripts/qa-001-verify.ts` to check a record against the gate.
- **Acceptance:** no live acceptance occurs before final deployment.

## Delivered slices

Branch protection forbade merging `fix/collections-outcome-reconciliation` (46 files, +4667/−274) as one push, so it was delivered as seven contiguous slices rebuilt from the updated `main`, each verified green at its boundary before opening.

| Slice | PR   | `main`     | Lines | Content                                           |
| ----- | ---- | ---------- | ----- | ------------------------------------------------- |
| P1    | #499 | `d22019df` | 752   | collections community work                        |
| P2    | #500 | `e77945e8` | 902   | treatment + payment guards                        |
| P3    | #501 | `0797ed78` | 740   | shared cash shift                                 |
| P4    | #503 | `984cec3e` | 577   | treasury cash                                     |
| P5    | #504 | `c1ebb17d` | 721   | modal focus trap + e2e CI steps                   |
| P6    | #505 | `566aa3bd` | 769   | treasury reconciliation (first backend slice)     |
| P7    | #506 | `38ba52eb` | 709   | community-work simulator + assessment range order |

Two independent PRs landed alongside the chain: #497 (`0d5c57a0`, security redaction) and #502 (`8ac774ff`, a flaky `DebtSearch` focus test).

Completeness was verified at the end rather than assumed per slice: `git diff --name-only origin/main 9b7f57a8` returns exactly nine files — the seven from #497, `DebtSearch.test.tsx` from #502, and the community-work spec repaired in #506. So `main` reproduces the reviewed candidate tip apart from those two unrelated PRs and one CI-driven fix, with nothing lost or duplicated across the seven slices.

The web suite grew monotonically across every boundary: 990 → 1010 → 1029 → 1047 → 1059 → 1072 → 1076.
