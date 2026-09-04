/** Published 0059 bytes accepted by the migration ledger. No other hash is valid. */
export const collectionsCompatibilityHashes = new Set([
  '86ac3253483a8c5d3f8dd8ce24d63aa104f3ecf56e8692a6a0f81f247503da51',
  '205b763361c954078ccf99081de1e22d26744c9a9d6370a52861d19df8a1d33a',
])

export const historicalBajaMetadataConstraint =
  "CHECK (((estado <> 'baja'::text) OR ((baja_motivo IS NOT NULL) AND (fecha_baja IS NOT NULL) AND (length(btrim(baja_motivo)) > 0))))"
export const canonicalBajaMetadataConstraint =
  "CHECK (((estado <> 'baja'::text) OR ((fecha_baja IS NOT NULL) AND (baja_motivo IS NOT NULL) AND (btrim(baja_motivo) <> ''::text))))"
