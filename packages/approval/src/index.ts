/**
 * @athlos/approval — public API.
 *
 * Two surfaces:
 *   1. `token.ts` — pure crypto helpers (`generateApprovalToken`,
 *      `hashApprovalToken`). Stateless, easy to unit-test.
 *   2. `service.ts` — Drizzle-backed create / get / consume. The
 *      `getApprovalToken` and `consumeApprovalToken` functions throw
 *      `BusinessError` with the right `ErrorCode` so the API error
 *      handler renders the spec-mandated 404 / 410.
 *
 * The approval routes (PR 3b) sit on top of this service.
 */
export { generateApprovalToken, hashApprovalToken } from './token.ts'
export {
  createApprovalToken,
  createCondonationApprovalRequest,
  decideCondonationApproval,
  findCondonationRequest,
  createCommunityWorkApprovalRequest,
  decideCommunityWorkApproval,
  findCommunityWorkRequest,
  communityWorkRequestFingerprint,
  listCondonationLifecycle,
  listCommunityWorkLifecycle,
  listCondonationQueue,
  getApprovalToken,
  consumeApprovalToken,
} from './service.ts'
export type {
  ApprovalTokenRecord,
  CondonationDecision,
  CondonationLifecycle,
  CondonationSnapshot,
  ListCondonationLifecycleInput,
  CommunityWorkLifecycle,
  ListCommunityWorkLifecycleInput,
  CondonationQueueEntry,
  ListCondonationQueueInput,
  CreateApprovalLinkRequest,
  CreateCondonationApprovalRequest,
  CommunityWorkSnapshot,
  CommunityWorkDecision,
  CreateCommunityWorkApprovalRequest,
} from './service.ts'
