import { beforeEach, describe, expect, it } from 'vitest'
import {
  COLLECTIONS_IDEMPOTENCY_STORAGE_KEY,
  createCollectionsIdempotencyStore,
  type CollectionsIdempotencyInput,
} from './collections-idempotency'

function storage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

const draft: CollectionsIdempotencyInput = {
  operatorId: 'operator-1',
  action: 'generate-assessments',
  draftFingerprint: 'period:2026-01',
}

describe('Collections idempotency store', () => {
  let session: Storage
  beforeEach(() => (session = storage()))

  it('reuses an ambiguous retry key and rotates it for a changed draft', () => {
    const store = createCollectionsIdempotencyStore(session)
    const key = store.getOrCreate(draft)
    expect(store.getOrCreate(draft)).toBe(key)
    expect(store.getOrCreate({ ...draft, draftFingerprint: 'period:2026-02' })).not.toBe(key)
  })

  it('stores only retry metadata and clears completed or abandoned actions', () => {
    const store = createCollectionsIdempotencyStore(session)
    const key = store.getOrCreate(draft)
    expect(JSON.parse(session.getItem(COLLECTIONS_IDEMPOTENCY_STORAGE_KEY)!)).toEqual([
      { ...draft, key },
    ])
    store.complete(draft)
    expect(session.getItem(COLLECTIONS_IDEMPOTENCY_STORAGE_KEY)).toBeNull()
    store.getOrCreate(draft)
    store.abandon(draft)
    expect(store.peek(draft)).toBeNull()
  })
  // prettier-ignore
  it('rotates a conflicted key before the reviewed retry',()=>{const store=createCollectionsIdempotencyStore(session),first=store.getOrCreate(draft);store.abandon(draft);expect(store.getOrCreate(draft)).not.toBe(first)})
})
