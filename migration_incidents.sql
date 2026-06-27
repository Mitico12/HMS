-- migration_incidents.sql
-- Run once in the Supabase SQL editor to add the new incident fields
-- to a database that already has the original schema.

alter table incidents add column if not exists root_cause_other  text;
alter table incidents add column if not exists consequence_other text;
alter table incidents add column if not exists is_anonymous boolean not null default false;
alter table incidents add column if not exists location     text;
alter table incidents add column if not exists occurred_at  timestamptz;
