-- Allows admins to import archived report logs from the Excel format exported by Logs.
-- Run after schema.sql and migration_report_types_archive.sql.

drop policy if exists inc_admin_insert on public.incidents;
create policy inc_admin_insert on public.incidents
  for insert
  with check (public.is_admin());
