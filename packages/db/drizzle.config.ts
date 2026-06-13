import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle Kit configuration. Lives inside `@athlos/db` (canonical layout —
 * see data-access-layer design §5 and database-migrations spec §2).
 *
 * Putting the config here means `pnpm --filter @athlos/db generate` finds
 * it without a `--config` flag and the paths below resolve from this
 * directory without absolute-path gymnastics.
 *
 * Schema source points at the barrel so adding a new table to
 * `packages/db/src/schema/<domain>.ts` and re-exporting it from
 * `packages/db/src/schema/index.ts` is the only edit needed to bring it
 * under migration tracking.
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://athlos:athlos@localhost:5432/athlos',
  },
  strict: true,
  verbose: true,
})
