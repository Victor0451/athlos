BEGIN;
DO $$ BEGIN
  IF to_regclass('public.audit_events') IS NULL THEN
    RAISE EXCEPTION 'audit_events prerequisite is missing';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username varchar(50) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL, role char(1) NOT NULL,
  can_reprint boolean NOT NULL DEFAULT false, can_anulate boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true, last_login_at timestamptz,
  failed_login_attempts integer NOT NULL DEFAULT 0, locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_name varchar(64) NOT NULL,
  scheduled_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
  status text NOT NULL DEFAULT 'pending', attempt integer NOT NULL DEFAULT 1, error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, triggered_by text NOT NULL DEFAULT 'scheduler'
);
CREATE INDEX IF NOT EXISTS idx_job_runs_job_name_started ON job_runs (job_name, started_at);
COMMIT;
