-- migration_report_types_archive.sql
-- Adds (1) a report-type tag that unifies incidents, hazards, and future
-- custom report kinds in one table, and (2) archiving, restricted to super admins.
-- Run once in the Supabase SQL editor, after the earlier migrations.

-- ── 1) Report type ────────────────────────────────────────────
alter table incidents add column if not exists report_type text not null default 'incident';
update incidents set report_type = 'incident' where coalesce(report_type, '') = '';

-- ── 2) Archiving ──────────────────────────────────────────────
alter table incidents add column if not exists archived    boolean     not null default false;
alter table incidents add column if not exists archived_at  timestamptz;
alter table incidents add column if not exists archived_by  uuid references profiles (id);

-- Active reports the worker/admin lists hit most; archived ones the Logs view hits.
create index if not exists incidents_active_idx
  on incidents (status) where archived = false;
create index if not exists incidents_archived_idx
  on incidents (report_type, archived_at desc) where archived = true;

-- ── 3) Archive / unarchive (super admin only; archive needs a resolved report) ──
create or replace function archive_report(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super() then
    raise exception 'Only super admins can archive reports.';
  end if;
  update incidents
     set archived = true, archived_at = now(), archived_by = auth.uid()
   where id = p_id and status = 'resolved' and archived = false;
  if not found then
    raise exception 'Report not found, not resolved, or already archived.';
  end if;
end; $$;
grant execute on function archive_report(uuid) to authenticated;

create or replace function unarchive_report(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super() then
    raise exception 'Only super admins can unarchive reports.';
  end if;
  update incidents
     set archived = false, archived_at = null, archived_by = null
   where id = p_id and archived = true;
  if not found then
    raise exception 'Archived report not found.';
  end if;
end; $$;
grant execute on function unarchive_report(uuid) to authenticated;
