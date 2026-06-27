-- Adds incident photos and submitted checklist logs.
-- Run this once in the Supabase SQL editor before using the new features.

alter table incidents
  add column if not exists photo_paths text[] not null default '{}';

alter table checklist_runs
  add column if not exists notes text,
  add column if not exists submitted_at timestamptz;

insert into storage.buckets (id, name, public)
values ('incident-photos', 'incident-photos', false)
on conflict (id) do nothing;

drop policy if exists "incident photos own upload" on storage.objects;
create policy "incident photos own upload" on storage.objects
  for insert
  with check (bucket_id = 'incident-photos' and auth.role() = 'authenticated');

drop policy if exists "incident photos read" on storage.objects;
create policy "incident photos read" on storage.objects
  for select
  using (bucket_id = 'incident-photos' and auth.role() = 'authenticated');

drop policy if exists "incident photos admin delete" on storage.objects;
create policy "incident photos admin delete" on storage.objects
  for delete
  using (bucket_id = 'incident-photos' and public.is_admin());
