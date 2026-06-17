import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * `job_runs` — one row per scheduled job invocation.
 *
 * State machine (spec §"Job Lifecycle"):
 *   pending → running → succeeded
 *                     → failed → (retry in place: attempt++) → running
 *                              → dead_letter (after 3 failed attempts)
 *
 * One row per invocation, NOT per attempt. Retries UPDATE the same row
 * (attempt column incremented) so history reads as "the 3pm drift-detection
 * run" rather than "the 3pm first-attempt row". `triggered_by` discriminates
 * the originating trigger: `scheduler` (cron tick), `manual` (admin endpoint),
 * `post-import` (the import-batch handler calling `runNow('freshness-refresh')`).
 *
 * Indexes:
 *   - `(job_name, started_at DESC)` for the admin history endpoint's
 *     "show me the last 50 runs of this job" query.
 *   - `(status)` partial index for "show me currently-running + dead-letter"
 *     health checks.
 */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobName: varchar('job_name', { length: 64 }).notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status')
      .notNull()
      .default('pending')
      .$type<'pending' | 'running' | 'succeeded' | 'failed' | 'dead_letter' | 'cancelled'>(),
    attempt: integer('attempt').notNull().default(1),
    errorMessage: text('error_message'),
    /** Free-form key-value bag (e.g. drift count, deleted token count). */
    metadata: jsonb('metadata').notNull().default({}),
    triggeredBy: text('triggered_by')
      .notNull()
      .default('scheduler')
      .$type<'scheduler' | 'manual' | 'post-import'>(),
  },
  (table) => ({
    jobNameStartedIdx: index('idx_job_runs_job_name_started').on(table.jobName, table.startedAt),
    statusIdx: index('idx_job_runs_status')
      .on(table.status)
      .where(sql`status IN ('running','failed','dead_letter')`),
  }),
)

export type JobRun = typeof jobRuns.$inferSelect
export type NewJobRun = typeof jobRuns.$inferInsert
export type JobRunStatus = JobRun['status']
export type JobTrigger = JobRun['triggeredBy']
