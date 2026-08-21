import { generateOpaqueIdempotencyKey } from './idempotency-key'

export const COLLECTIONS_IDEMPOTENCY_STORAGE_KEY = 'athlos:collections:idempotency'

export interface CollectionsIdempotencyInput {
  operatorId: string
  action: string
  draftFingerprint: string
}
export interface CollectionsIdempotencyRecord extends CollectionsIdempotencyInput {
  key: string
}
export interface CollectionsIdempotencyStore {
  getOrCreate(input: CollectionsIdempotencyInput): string
  peek(input: CollectionsIdempotencyInput): CollectionsIdempotencyRecord | null
  complete(input: CollectionsIdempotencyInput): void
  abandon(input: CollectionsIdempotencyInput): void
}

const sessionStorageOrUndefined = (): Storage | undefined => {
  if (typeof window === 'undefined') return undefined
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

const matches = (record: CollectionsIdempotencyRecord, input: CollectionsIdempotencyInput) =>
  record.operatorId === input.operatorId &&
  record.action === input.action &&
  record.draftFingerprint === input.draftFingerprint

export function createCollectionsIdempotencyStore(
  storage: Storage | undefined = sessionStorageOrUndefined(),
): CollectionsIdempotencyStore {
  let fallback: CollectionsIdempotencyRecord[] = []
  const read = (): CollectionsIdempotencyRecord[] => {
    if (!storage) return fallback
    try {
      const value = storage.getItem(COLLECTIONS_IDEMPOTENCY_STORAGE_KEY)
      if (!value) return []
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as CollectionsIdempotencyRecord[]) : []
    } catch {
      return fallback
    }
  }
  const save = (records: CollectionsIdempotencyRecord[]) => {
    fallback = records
    if (!storage) return
    try {
      if (records.length) {
        storage.setItem(COLLECTIONS_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(records))
      } else {
        storage.removeItem(COLLECTIONS_IDEMPOTENCY_STORAGE_KEY)
      }
    } catch {
      // The in-memory fallback keeps the current action retryable.
    }
  }
  const remove = (input: CollectionsIdempotencyInput) =>
    save(read().filter((record) => !matches(record, input)))

  return {
    getOrCreate(input) {
      const current = read()
      const existing = current.find((record) => matches(record, input))
      if (existing) return existing.key
      const record = { ...input, key: generateOpaqueIdempotencyKey() }
      save([
        ...current.filter(
          (item) => item.operatorId !== input.operatorId || item.action !== input.action,
        ),
        record,
      ])
      return record.key
    },
    peek: (input) => read().find((record) => matches(record, input)) ?? null,
    complete: remove,
    abandon: remove,
  }
}
