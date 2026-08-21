## Exploration: Native Collections Web UI/UX

### Current State

The native dues domain is complete and independently verified in the existing `club-dues-collection-and-daily-cash` change: effective-dated base/sport pricing, idempotent monthly assessments, immutable obligations, debt totals, explicit settlements/allocations, append-only reversals, cash shifts, and optional one-way CTACTE projection. Its final verification reports 16/16 requirements and 22/22 scenarios passing.

The Web is not an operator product for this domain. It has a feature-gated `/tesoreria` cash-desk screen and typed cash API client, but no dues API client, pricing administration, period generation, member debt view, settlement/allocation flow, or reversal history. Navigation exposes only `cashEnabled`; `/tesoreria` is hidden when it is false. Native dues routes are gated by `DUES_ASSESSMENT_ENABLED`, while CTACTE projection is separately gated by `DUES_CTACTE_PROJECTION_ENABLED`.

The first slice can reuse existing API commands, but not yet provide the requested explanatory debt detail end-to-end: `GET /api/v1/dues/socios/:socioId/debt` returns outstanding obligations and totals only. It does not return immutable components, applied benefits, allocation/settlement history, or a discoverable reversal target. There is also no native arrears/member search endpoint. These are bounded read-contract gaps, not a reason to redesign the ledger.

### Affected Areas

- `apps/web/src/lib/navigation.ts` and `apps/web/src/app/(authed)/layout.tsx` — expose a dedicated Collections workspace based on the assessment capability, rather than treating cash desk visibility as the entire dues product.
- `apps/web/src/lib/features.tsx` — currently carries only `cashEnabled`; it must represent the Web capabilities needed for a safe progressive rollout.
- `apps/web/src/lib/api.ts` and new `apps/web/src/lib/api/dues.ts` — the shared fetcher already supports headers, including `Idempotency-Key`; typed native-dues wrappers and stable per-submit keys are missing.
- `apps/web/src/app/(authed)/collections/**` (new) — pricing, generation, debt, settlement, and reversal operator journeys should be grouped as a dedicated workspace, not embedded in legacy CTACTE.
- `apps/api/src/routes/dues.ts` and `apps/api/src/modules/dues/allocations.ts` — only if the new Web needs the missing read models for debt composition, allocation history, reversal eligibility, or member/arrears discovery.
- `apps/web/src/lib/api/treasury.ts` and `apps/web/src/app/(authed)/tesoreria/**` — remain a later integration boundary; monetary settlement is not automatically a cash tender in the proposed first slice.
- `apps/web/src/**/*.test.tsx` and `apps/web/e2e/**` — operator-flow, responsive, accessible-state, and permission-denial coverage are required before enabling the capability.

### Operator Flows and UI/UX Requirements

| Journey | Happy path | Required states and safeguards |
|---|---|---|
| Configure pricing | ADMIN creates a dated base or sport price, reviews active versions, and revokes an incorrect version with a reason. | Explain effective interval and assessment rule; prevent accidental overlap through server-error mapping; show loading, empty catalog, conflict, and post-save audit-safe confirmation. |
| Generate a month | ADMIN/TESORERO selects one calendar period, confirms generation, and receives a created/replayed result. | Use a confirmation step that states the operation is idempotent but financially consequential; disable duplicate submit; preserve/retry the same idempotency key after ambiguous network failure; show zero-obligation and conflict outcomes. |
| Explain debt | Authorized operator locates a member, sees total outstanding debt and each period, then opens a debt detail. | The detail must distinguish original amount, outstanding amount, components, benefits, allocations, and reversals; disclose only authorized member data; provide empty, not-found, unavailable, and stale-after-payment states. |
| Collect and allocate | ADMIN/TESORERO chooses monetary payment, amount, currency, and one or more explicit allocation amounts; the UI continuously reconciles payment total against allocations. | Do not silently apply oldest debt; support partial payments; block client submit until allocations are positive, unique, and do not exceed payment/debt; map 409 balance races to a refresh-and-review action. |
| Reverse | ADMIN/TESORERO selects a posted allocation, reviews its original settlement/obligation/amount, supplies a mandatory reason, and receives an append-only compensation result. | Use a destructive-action confirmation; never offer edit/delete; make already-reversed and concurrent-reversal conflicts intelligible; refresh debt/history after success. |

Accessibility is part of every journey: semantic page landmarks and headings, labelled money/date inputs, keyboard-operable dialogs and allocation controls, focus moved to success/error status, `role="alert"` for failures, non-color status cues, and responsive tables with an accessible small-screen representation. Existing Web patterns already use status/alert containers and Playwright checks for named controls, overflow, containment, and overlap.

### Product Decision Gaps

| Decision | Current evidence | Recommendation for this change |
|---|---|---|
| CTACTE projection granularity | Projection is a deployment-level feature flag and the API accepts a source record; it is not an operator or transaction preference. | Keep projection disabled and absent from first-slice UI. Do not imply a choice exists. Record the granularity decision as a follow-up prerequisite for compatibility UX: deployment policy, per shift, per operator, or per transaction. |
| Authorization model | API services use coarse roles: pricing is ADMIN; generation, settlement, reversal, and debt are ADMIN/TESORERO. `CurrentUser.permissions` has no dues permissions. | Adopt the current role model for the first UI slice and enforce it server-side. Do not introduce client-only authorization. Before broader rollout, decide whether roles are sufficient or whether audited granular permissions are required, especially for reversal and monthly generation. |
| Debt explanation contract | Current debt API exposes only period/amount/outstanding. | Add a minimized native read model only if it exposes immutable obligation composition, applied benefits, allocations, settlement/reversal links, and reversal eligibility without raw audit/evidence leakage. |
| Member discovery | No native arrears list/search contract was found. | Start from a known Socio detail/search entry point or add a bounded authorized member lookup. Defer a full morosity dashboard to a later slice. |
| Cash linkage | Cash tender recording is a separate explicit command; a settlement is not automatically a tender. | Keep cash opening/tender/close out of this slice. The collection confirmation must state that it records native debt settlement, not cash reconciliation. |

### Approaches

1. **Extend `club-dues-collection-and-daily-cash`** — add the Web work to the completed backend change.
   - Pros: one historical narrative for the whole dues domain.
   - Cons: mixes a verified, implementation-complete backend artifact with a new product surface; obscures review scope, completion status, and rollout boundaries.
   - Effort: Medium implementation, High governance risk.

2. **Create bounded `native-collections-web` change** — build the first Web vertical slice over existing backend contracts, with only minimal read-contract additions where evidence proves them necessary.
   - Pros: preserves the completed backend audit trail; gives Web UX, navigation, capability gating, authorization, and accessibility their own acceptance criteria; supports sub-400-line chained delivery.
   - Cons: requires explicit cross-change references and exposes a small API-read-model scope if the present debt response is insufficient.
   - Effort: Medium to High, safely chainable.

### Recommendation

Create the new, clearly bounded `native-collections-web` change. Its proposal/spec/design should cover the first vertical slice only: pricing → monthly generation → member debt detail → monetary payment with explicit allocation → append-only reversal, operating with CTACTE projection disabled.

The change MUST reuse the native ledger as source of truth; MUST NOT modify obligations, perform implicit allocation, dual-write CTACTE, or include cash close, benefits/family administration, agreements, community work, or an arrears dashboard. It MAY add narrowly authorized read DTOs needed to explain an existing obligation and choose/reverse an allocation. A likely delivery chain is: (1) capability/navigation and typed contracts, (2) pricing plus generation, (3) debt explanation, (4) settlement/allocation and reversal, with each work unit forecast below the 400-line budget.

### Risks

- The present API cannot show components, benefit application, allocation history, or reversal eligibility; inventing those facts in the UI would misrepresent financial history.
- A fresh browser retry must reuse the original idempotency key when the outcome is unknown; generating a new key can duplicate a user action attempt even though the server protects individual keys.
- Client navigation hiding is not authorization. API role enforcement remains authoritative, and the current coarse role model needs an explicit product decision before adding finer permissions.
- Treating a monetary settlement as cash tender would bypass the explicit cash-shift lifecycle and corrupt reconciliation expectations.
- Projection UX before a CTACTE granularity decision could cause silent compatibility behavior or operator confusion; keep it disabled and out of scope.
- This UI spans several financial commands and can exceed the 400-line review budget. Use the requested auto-chain strategy rather than a single UI PR.

### Ready for Proposal

Yes — create a new `native-collections-web` proposal. Carry the CTACTE granularity and long-term authorization questions as explicit decisions, while fixing the first-slice policy to no projection and current server-enforced roles. The proposal must identify the required debt read-model fields before implementation; if those fields cannot be exposed safely, it must stop at a debt summary rather than fabricate a detail experience.
