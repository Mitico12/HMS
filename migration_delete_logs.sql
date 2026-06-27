-- migration_delete_logs.sql
-- Lets super admins permanently delete log entries: archived reports and
-- submitted checklist runs. Run once in the Supabase SQL editor.
-- Both are security-definer RPCs that enforce is_super() themselves, so the
-- permission lives in the database rather than only in the UI.

-- Delete an archived report. Restricted to archived rows so the logs flow can
-- never reach back and remove an active incident. Dependent incident_actions
-- are removed by the existing on-delete-cascade. Photo objects in storage are
-- deleted client-side before this RPC is called.
create or replace function delete_report(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super() then
    raise exception 'Only super admins can delete reports.';
  end if;
  delete from incidents where id = p_id and archived = true;
  if not found then
    raise exception 'Archived report not found.';
  end if;
end; $$;
grant execute on function delete_report(uuid) to authenticated;

-- Delete a submitted checklist run (a checklist log entry).
create or replace function delete_checklist_run(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super() then
    raise exception 'Only super admins can delete checklist logs.';
  end if;
  delete from checklist_runs where id = p_id;
  if not found then
    raise exception 'Checklist log not found.';
  end if;
end; $$;
grant execute on function delete_checklist_run(uuid) to authenticated;
