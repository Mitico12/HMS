-- Adds saved ordering for admin-managed content lists.
-- Run once in Supabase before relying on drag-to-reorder persistence.

alter table checklists
  add column if not exists sort_order int not null default 0;

alter table procedures
  add column if not exists sort_order int not null default 0;

alter table documents
  add column if not exists sort_order int not null default 0;
