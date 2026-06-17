// TASK-064 implements the real verifyHash
export interface HashVerificationResult {
  entity_id: string
  match: boolean
  stored_hash: string
  recomputed_hash: string
  verified_at: string
}

export async function verifyHash(): Promise<HashVerificationResult> {
  throw new Error('TASK-064 not implemented')
}
