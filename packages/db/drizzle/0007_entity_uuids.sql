-- TASK-061: entity_uuids — stable UUID identity for every imported entity
--
-- UUIDs are generated at first-import and reused on every subsequent
-- re-import of the same (source_table, source_key). The composite PK
-- enforces uniqueness of the legacy key pair; the UNIQUE constraint
-- on entity_uuid ensures every entity has exactly one UUID system-wide.
CREATE TABLE "entity_uuids" (
  "source_table" varchar(32) NOT NULL,
  "source_key"   varchar(64) NOT NULL,
  "entity_uuid"  uuid NOT NULL UNIQUE,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("source_table", "source_key")
);