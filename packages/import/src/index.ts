/**
 * @athlos/import — public API.
 *
 * The legacy import pipeline. PR 7a ships the foundation; PR 7b
 * adds lineage/projection/drift/freshness; PR 7c adds audit + routes.
 *
 * The package owns:
 *   - `readTable` — async iterable over a legacy DBF file
 *   - `computeHash` — canonical SHA-256 of a legacy record
 *   - `runImport` — ordered batch insert into `raw_events`
 *   - `validateBridges` — orphan check on CONNROASIE + dependency order
 *
 * Job handlers in `apps/api/src/jobs/{scheduled-import,drift-detection,...}`
 * call into this package; the import routes (PR 7c) call into it too.
 * No HTTP concerns leak in here.
 */
export { readTable, readTableFromTable, type LegacyRecord } from './dbf-reader.ts'
export { computeHash } from './hash.ts'
export {
  runImport,
  LEGACY_IMPORT_ORDER,
  TABLE_DEPENDENCIES,
  type ImportBatch,
  type ImportTableSummary,
  type RunImportOptions,
} from './pipeline.ts'
export { validateBridges, type OrphanAlert } from './bridge-validator.ts'
