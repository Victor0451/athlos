// TASK-063 implements the real queryLineage
export interface LineageResponse {
  entity_id: string
  source_table: string
  source_key: string
  content_hash: string
  imported_at: string
  import_batch: string
  audit_event_id: string | null
}

export async function queryLineage(): Promise<LineageResponse | null> {
  throw new Error('TASK-063 not implemented')
}
