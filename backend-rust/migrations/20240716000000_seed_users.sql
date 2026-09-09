-- Compatibility migration for the previously expected seed-users step.
-- The current codebase no longer depends on a hard-coded seed user and this
-- migration keeps the migration history consistent for local development.
SELECT 1;
