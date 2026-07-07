/**
 * Public surface of the file-storage module.
 *
 * `LocalFileStorage` is the storage abstraction used by the
 * `socio_attachments` service. `validateMagic` is a pure-function
 * validator that sniffs the leading bytes (and PDF trailer) of an
 * uploaded buffer to reject mismatched MIME declarations.
 *
 * PR 8c.1 (athlos-socio-legajo).
 */
export { LocalFileStorage, SizeLimitError, readStorageEnv } from './local-file-storage.ts'
export type {
  LocalFileStorageOptions,
  SaveStreamOptions,
  SaveStreamResult,
} from './local-file-storage.ts'
export { validateMagic } from './magic-byte.ts'
export type { AllowedMime } from './magic-byte.ts'
