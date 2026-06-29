-- ============================================================================
--  NICOSOFT HMS — CONSOLIDATED SCHEMA  (schema_full.sql)
--  Generated 2026-06-29.  Project: vtiobzmsalsvwocvlotm
--
--  This single file is the full database as currently applied: schema.sql plus
--  every migration patch, concatenated in the exact dependency order they must
--  run. It is the canonical source of truth — the individual schema/migration
--  files can be archived.
--
--  HOW TO USE
--   • Fresh project: run this whole file once in the Supabase SQL editor.
--   • Existing project (already migrated): it is safe to re-run. Every statement
--     is idempotent (create table/extension if not exists, add column if not
--     exists, create or replace function, drop policy if exists + create). Where
--     a function or policy is defined more than once across patches, the LAST
--     (newest) definition is the one that takes effect — that is why order is
--     preserved exactly.
--
--  ORDER OF SECTIONS (each begins with a == SECTION n == banner below):
--    1 schema.sql                              12 migration_content_images.sql
--    2 schema_users_patch.sql                  13 migration_courses.sql
--    3 migration_username_ranks.sql            14 migration_course_assignments.sql
--    4 migration_mobile_number_users.sql       15 migration_checklist_review.sql
--    5 migration_profile_change_mobile.sql     16 migration_roles_varsling.sql
--    6 migration_incidents.sql                 17 migration_report_form_configs.sql
--    7 migration_incident_photos_checklist_logs 18 migration_sysadmin_guard.sql
--    8 migration_report_types_archive.sql      19 migration_group_delete_requests.sql
--    9 migration_import_excel_logs.sql         20 migration_varsling_insert_fix.sql
--   10 migration_delete_logs.sql               21 migration_dedupe_default_groups.sql
--   11 migration_reorderable_content.sql
--
--  NOTE: section 21 (dedupe_default_groups) is a one-time data cleanup; it is a
--  harmless no-op on a fresh database.
-- ============================================================================



-- ============================================================================
-- == SECTION 01 / 21 :  schema.sql
-- ============================================================================

-- ============================================================
--  COMPANY OPS APP — Supabase schema
--  Run this whole file once in the Supabase SQL editor.
--  Order matters: extensions, tables, trigger, storage, RLS, seed.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
--  PROFILES  (extends auth.users with a role)
-- ------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  mobile_number text,
  role        text not null default 'user',   -- 'user' | 'admin' | 'super_admin'
  is_verified boolean not null default false,  -- admin must approve before access
  username    text,                            -- optional login handle (unique, case-insensitive)
  created_at  timestamptz not null default now()
);
create unique index if not exists profiles_username_lower_key on profiles (lower(username));

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into profiles (id, email, full_name, username, mobile_number)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          new.raw_user_meta_data->>'username',
          new.raw_user_meta_data->>'mobile_number')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Helper: is the calling user an admin (either rank)? Used by RLS policies below.
create or replace function is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('admin','super_admin')
  );
$$;

create or replace function is_super()
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'super_admin');
$$;

-- Username → email lookup for login (callable before authentication).
create or replace function get_email_for_username(p_username text) returns text
language sql security definer set search_path = public stable as $$
  select email from profiles where lower(username) = lower(p_username) limit 1;
$$;
grant execute on function get_email_for_username(text) to anon, authenticated;

create or replace function username_available(p_username text) returns boolean
language sql security definer set search_path = public stable as $$
  select not exists (select 1 from profiles where lower(username) = lower(p_username));
$$;
grant execute on function username_available(text) to anon, authenticated;

-- Approve / revoke an account. Normal admins can't touch admin accounts.
create or replace function set_verification(target uuid, verified boolean) returns void
language plpgsql security definer set search_path = public as $$
declare caller_role text; target_role text;
begin
  select role into caller_role from profiles where id = auth.uid();
  select role into target_role from profiles where id = target;
  if caller_role not in ('admin','super_admin') then raise exception 'Not authorized'; end if;
  if caller_role = 'admin' and target_role in ('admin','super_admin') then
    raise exception 'Normal admins cannot modify admin accounts';
  end if;
  update profiles set is_verified = verified where id = target;
end; $$;
grant execute on function set_verification(uuid, boolean) to authenticated;

-- Change a role. super_admin: any change. admin: only promote a user to admin.
create or replace function set_role(target uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
declare caller_role text; target_role text;
begin
  if new_role not in ('user','admin','super_admin') then raise exception 'Invalid role'; end if;
  select role into caller_role from profiles where id = auth.uid();
  select role into target_role from profiles where id = target;
  if caller_role = 'super_admin' then
    update profiles set role = new_role,
      is_verified = case when new_role <> 'user' then true else is_verified end
      where id = target;
    return;
  end if;
  if caller_role = 'admin' then
    if target_role <> 'user' or new_role <> 'admin' then
      raise exception 'Normal admins can only promote a user to admin';
    end if;
    update profiles set role = 'admin', is_verified = true where id = target;
    return;
  end if;
  raise exception 'Not authorized';
end; $$;
grant execute on function set_role(uuid, text) to authenticated;

-- ------------------------------------------------------------
--  GROUPS  (the home-page tiles)
-- ------------------------------------------------------------
create table if not exists groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  icon        text default '📁',          -- emoji shown on the tile
  kind        text not null default 'procedures',  -- checklist | reports | documents | procedures
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
--  PROCEDURES  (admin-built forms inside a 'procedures' group)
--  fields jsonb: [{ key, type, label, required, options[] }]
--  type: 'short' | 'long' | 'number' | 'dropdown' | 'checkbox'
-- ------------------------------------------------------------
create table if not exists procedures (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups (id) on delete cascade,
  title       text not null,
  description text,
  fields      jsonb not null default '[]'::jsonb,
  is_draft    boolean not null default true,
  sort_order  int not null default 0,
  created_by  uuid references profiles (id),
  created_at  timestamptz not null default now()
);

create table if not exists procedure_submissions (
  id            uuid primary key default gen_random_uuid(),
  procedure_id  uuid not null references procedures (id) on delete cascade,
  user_id       uuid not null references profiles (id),
  answers       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
--  CHECKLISTS
--  items jsonb: [{ id, label }]
-- ------------------------------------------------------------
create table if not exists checklists (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups (id) on delete cascade,
  title       text not null,
  items       jsonb not null default '[]'::jsonb,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- One row per user per checklist; rewritten on every tick for traceability.
create table if not exists checklist_runs (
  id            uuid primary key default gen_random_uuid(),
  checklist_id  uuid not null references checklists (id) on delete cascade,
  user_id       uuid not null references profiles (id),
  checked       jsonb not null default '{}'::jsonb,   -- { item_id: { done: true, at: iso } }
  completed     boolean not null default false,
  notes         text,
  submitted_at  timestamptz,
  updated_at    timestamptz not null default now(),
  unique (checklist_id, user_id)
);

-- ------------------------------------------------------------
--  INCIDENT CATEGORIES  (admin-managed)
-- ------------------------------------------------------------
create table if not exists incident_categories (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,              -- 'root_cause' | 'consequence'
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
--  INCIDENTS
-- ------------------------------------------------------------
create table if not exists incidents (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references profiles (id),
  what_happened    text not null,
  what_wrong       text,
  root_cause_ids   jsonb not null default '[]'::jsonb,    -- [category_id]
  consequence_ids  jsonb not null default '[]'::jsonb,    -- [category_id]
  root_cause_other  text,                                 -- free-text "Other" root cause
  consequence_other text,                                 -- free-text "Other" consequence
  photo_paths      text[] not null default '{}',
  status           text not null default 'open',          -- open | in_progress | resolved
  assigned_to      uuid references profiles (id),
  final_report     text,
  is_anonymous     boolean not null default false,        -- hide reporter identity in the UI
  location         text,                                  -- where it happened (optional)
  occurred_at      timestamptz,                           -- when it happened (reporter-set)
  created_at       timestamptz not null default now(),    -- when it was submitted
  resolved_at      timestamptz
);

-- The running log of actions/notes added while an incident is processed.
create table if not exists incident_actions (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references incidents (id) on delete cascade,
  author_id    uuid not null references profiles (id),
  note         text not null,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
--  DOCUMENTS  (files in a 'documents' group; bytes live in Storage)
-- ------------------------------------------------------------
create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references groups (id) on delete cascade,
  name          text not null,
  storage_path  text not null,
  mime_type     text,
  size_bytes    bigint,
  sort_order    int not null default 0,
  uploaded_by   uuid references profiles (id),
  created_at    timestamptz not null default now()
);

-- ============================================================
--  STORAGE
--  Create buckets named 'documents' and 'incident-photos' (private) in the Storage UI,
--  or uncomment the line below.
-- ============================================================
-- insert into storage.buckets (id, name, public) values ('documents','documents', false) on conflict do nothing;
-- insert into storage.buckets (id, name, public) values ('incident-photos','incident-photos', false) on conflict do nothing;

-- Storage RLS: admins manage the bucket, signed-in users can read (for signed URLs).
drop policy if exists "documents admin all" on storage.objects;
create policy "documents admin all" on storage.objects
  for all
  using      (bucket_id = 'documents' and public.is_admin())
  with check (bucket_id = 'documents' and public.is_admin());

drop policy if exists "documents read" on storage.objects;
create policy "documents read" on storage.objects
  for select
  using (bucket_id = 'documents' and auth.role() = 'authenticated');

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

-- ============================================================
--  ROW LEVEL SECURITY
--  Baseline policies: every authenticated user can read shared
--  content; users own their own runs/submissions/incidents;
--  admins write everything. Review before production use.
-- ============================================================
alter table profiles              enable row level security;
alter table groups                enable row level security;
alter table procedures            enable row level security;
alter table procedure_submissions enable row level security;
alter table checklists            enable row level security;
alter table checklist_runs        enable row level security;
alter table incident_categories   enable row level security;
alter table incidents             enable row level security;
alter table incident_actions      enable row level security;
alter table documents             enable row level security;

-- profiles: read own + (admins read all); update own non-role fields
drop policy if exists profiles_read on profiles;
create policy profiles_read   on profiles for select using (id = auth.uid() or is_admin());
drop policy if exists profiles_update on profiles;
create policy profiles_update   on profiles for update using (is_super()) with check (is_super());

-- shared read content (groups, procedures, checklists, categories, documents)
drop policy if exists groups_read on groups;
create policy groups_read   on groups              for select using (auth.role() = 'authenticated');
drop policy if exists groups_admin on groups;
create policy groups_admin   on groups              for all    using (is_admin()) with check (is_admin());

drop policy if exists proc_read on procedures;
create policy proc_read   on procedures          for select using (auth.role() = 'authenticated');
drop policy if exists proc_admin on procedures;
create policy proc_admin   on procedures          for all    using (is_admin()) with check (is_admin());

drop policy if exists check_read on checklists;
create policy check_read   on checklists          for select using (auth.role() = 'authenticated');
drop policy if exists check_admin on checklists;
create policy check_admin   on checklists          for all    using (is_admin()) with check (is_admin());

drop policy if exists cat_read on incident_categories;
create policy cat_read   on incident_categories for select using (auth.role() = 'authenticated');
drop policy if exists cat_admin on incident_categories;
create policy cat_admin   on incident_categories for all    using (is_admin()) with check (is_admin());

drop policy if exists doc_read on documents;
create policy doc_read   on documents           for select using (auth.role() = 'authenticated');
drop policy if exists doc_admin on documents;
create policy doc_admin   on documents           for all    using (is_admin()) with check (is_admin());

-- checklist_runs: a user manages only their own row; admins read all
drop policy if exists runs_own on checklist_runs;
create policy runs_own   on checklist_runs      for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists runs_admin_read on checklist_runs;
create policy runs_admin_read   on checklist_runs      for select using (is_admin());

-- procedure_submissions: user inserts/reads own; admins read all
drop policy if exists sub_own on procedure_submissions;
create policy sub_own   on procedure_submissions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists sub_admin_read on procedure_submissions;
create policy sub_admin_read   on procedure_submissions for select using (is_admin());

-- incidents: reporter reads own; admins read & write all; reporter inserts own
drop policy if exists inc_insert on incidents;
create policy inc_insert   on incidents for insert with check (reporter_id = auth.uid());
drop policy if exists inc_admin_insert on incidents;
create policy inc_admin_insert   on incidents for insert with check (is_admin());
drop policy if exists inc_read on incidents;
create policy inc_read   on incidents for select using (reporter_id = auth.uid() or is_admin());
drop policy if exists inc_admin_write on incidents;
create policy inc_admin_write   on incidents for update using (is_admin()) with check (is_admin());

-- incident_actions: admins write; reporter of the parent incident may read
drop policy if exists act_admin on incident_actions;
create policy act_admin   on incident_actions for all using (is_admin()) with check (is_admin());
drop policy if exists act_read on incident_actions;
create policy act_read   on incident_actions for select using (
  is_admin() or exists (
    select 1 from incidents i
    where i.id = incident_actions.incident_id and i.reporter_id = auth.uid()
  )
);

-- ============================================================
--  SEED  (the three default groups + starter incident categories)
-- ============================================================
-- Default groups are seeded safely in migration_dedupe_default_groups.sql.
-- The old direct seed is kept here as a reference only; do not run it repeatedly.
/*
insert into groups (name, icon, kind, sort_order) values
  ('Checklists',    '✅', 'checklist',  1),
  ('Reports',       '⚠️', 'reports',    2),
  ('Documentation', '📄', 'documents',  3)
on conflict do nothing;
*/

insert into incident_categories (kind, name, sort_order) values
  ('root_cause', 'Faulty procedures',  1),
  ('root_cause', 'Human error',        2),
  ('root_cause', 'Equipment failure',  3),
  ('root_cause', 'Lack of training',   4),
  ('consequence', 'Death',                  1),
  ('consequence', 'Injury or sick leave',   2),
  ('consequence', 'Environmental impact',   3),
  ('consequence', 'Financial loss',         4),
  ('consequence', 'Operational disruption', 5)
on conflict do nothing;

-- ============================================================
--  AFTER RUNNING: promote yourself to admin once you've signed up,
--  replacing the email below:
--    update profiles set role = 'admin' where email = 'you@example.com';
-- ============================================================


-- ============================================================================
-- == SECTION 02 / 21 :  schema_users_patch.sql
-- ============================================================================

-- Users/profile-change patch for the Ops static app.
-- Run this in Supabase SQL editor after your existing schema.sql.
-- It adds profile-change approvals and previous-email history.

create extension if not exists pgcrypto;

-- Your app already uses username_available/get_email_for_username, so username likely exists.
-- This keeps older copies safe.
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists mobile_number text;

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username))
  where username is not null and length(trim(username)) > 0;

create table if not exists public.profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  current_full_name text,
  requested_full_name text,
  current_username text,
  requested_username text,
  current_email text,
  requested_email text,
  current_mobile_number text,
  requested_mobile_number text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  admin_note text
);

create index if not exists profile_change_requests_user_idx
  on public.profile_change_requests(user_id, requested_at desc);
create index if not exists profile_change_requests_status_idx
  on public.profile_change_requests(status, requested_at desc);

alter table public.profile_change_requests add column if not exists current_mobile_number text;
alter table public.profile_change_requests add column if not exists requested_mobile_number text;

create table if not exists public.profile_email_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  old_email text,
  new_email text,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id),
  source text,
  request_id uuid references public.profile_change_requests(id) on delete set null
);

create index if not exists profile_email_log_user_idx
  on public.profile_email_log(user_id, changed_at desc);

alter table public.profile_change_requests enable row level security;
alter table public.profile_email_log enable row level security;

drop policy if exists "Users can read own profile change requests" on public.profile_change_requests;
create policy "Users can read own profile change requests"
  on public.profile_change_requests for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own profile change requests" on public.profile_change_requests;
create policy "Users can create own profile change requests"
  on public.profile_change_requests for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can read all profile change requests" on public.profile_change_requests;
create policy "Admins can read all profile change requests"
  on public.profile_change_requests for select
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin')
  ));

drop policy if exists "Admins can update profile change requests" on public.profile_change_requests;
create policy "Admins can update profile change requests"
  on public.profile_change_requests for update
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin')
  ));

drop policy if exists "Users can read own email log" on public.profile_email_log;
create policy "Users can read own email log"
  on public.profile_email_log for select
  using (auth.uid() = user_id);

drop policy if exists "Admins can read all email logs" on public.profile_email_log;
create policy "Admins can read all email logs"
  on public.profile_email_log for select
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin')
  ));

drop policy if exists "Admins can insert email logs" on public.profile_email_log;
create policy "Admins can insert email logs"
  on public.profile_email_log for insert
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin')
  ));

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin')
  );
$$;

drop function if exists public.request_profile_change(text, text, text);
create or replace function public.request_profile_change(
  p_full_name text,
  p_username text,
  p_email text,
  p_mobile_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_id uuid;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid();

  if not found then
    raise exception 'No profile found for current user.';
  end if;

  if coalesce(trim(p_username), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'Username and email are required.';
  end if;

  if exists (
    select 1 from public.profile_change_requests
    where user_id = v_profile.id and status = 'pending'
  ) then
    raise exception 'You already have a pending profile change.';
  end if;

  if lower(coalesce(p_username, '')) <> lower(coalesce(v_profile.username, ''))
     and exists (
       select 1 from public.profiles
       where lower(username) = lower(p_username) and id <> v_profile.id
     ) then
    raise exception 'That username is taken.';
  end if;

  insert into public.profile_change_requests (
    user_id,
    current_full_name, requested_full_name,
    current_username, requested_username,
    current_email, requested_email,
    current_mobile_number, requested_mobile_number
  ) values (
    v_profile.id,
    v_profile.full_name, nullif(trim(p_full_name), ''),
    v_profile.username, trim(p_username),
    v_profile.email, trim(p_email),
    v_profile.mobile_number, nullif(trim(p_mobile_number), '')
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.approve_profile_change_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_req public.profile_change_requests%rowtype;
  v_admin uuid := auth.uid();
begin
  if not public.is_current_user_admin() then
    raise exception 'Only admins can approve profile changes.';
  end if;

  select * into v_req
  from public.profile_change_requests
  where id = p_request and status = 'pending'
  for update;

  if not found then
    raise exception 'Pending request not found.';
  end if;

  if lower(coalesce(v_req.requested_username, '')) <> lower(coalesce(v_req.current_username, ''))
     and exists (
       select 1 from public.profiles
       where lower(username) = lower(v_req.requested_username) and id <> v_req.user_id
     ) then
    raise exception 'That username is taken.';
  end if;

  update public.profiles
  set full_name = v_req.requested_full_name,
      username = v_req.requested_username,
      email = v_req.requested_email,
      mobile_number = v_req.requested_mobile_number
  where id = v_req.user_id;

  if coalesce(v_req.current_email, '') <> coalesce(v_req.requested_email, '') then
    insert into public.profile_email_log(user_id, old_email, new_email, changed_by, source, request_id)
    values (v_req.user_id, v_req.current_email, v_req.requested_email, v_admin, 'admin approval', v_req.id);

    -- Keep email login aligned with public.profiles.email.
    -- If your Supabase project disallows direct auth schema updates, replace this part with an Edge Function using the service role key.
    update auth.users
    set email = v_req.requested_email,
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
          || jsonb_build_object('email', v_req.requested_email, 'username', v_req.requested_username, 'full_name', v_req.requested_full_name, 'mobile_number', v_req.requested_mobile_number),
        updated_at = now()
    where id = v_req.user_id;

    update auth.identities
    set identity_data = coalesce(identity_data, '{}'::jsonb)
      || jsonb_build_object('email', v_req.requested_email, 'sub', v_req.user_id::text),
        updated_at = now()
    where user_id = v_req.user_id and provider = 'email';
  end if;

  update public.profile_change_requests
  set status = 'approved', reviewed_by = v_admin, reviewed_at = now()
  where id = v_req.id;
end;
$$;

create or replace function public.reject_profile_change_request(p_request uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Only admins can reject profile changes.';
  end if;

  update public.profile_change_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), admin_note = nullif(trim(p_note), '')
  where id = p_request and status = 'pending';

  if not found then
    raise exception 'Pending request not found.';
  end if;
end;
$$;


-- ============================================================================
-- == SECTION 03 / 21 :  migration_username_ranks.sql
-- ============================================================================

-- migration_username_ranks.sql
-- Adds (1) usernames for login and (2) two admin ranks: 'admin' and 'super_admin'.
-- Rank rules are enforced in the database, not just the UI.

-- ── 1) Username column, case-insensitive uniqueness ───────────
alter table profiles add column if not exists username text;
create unique index if not exists profiles_username_lower_key on profiles (lower(username));

-- ── 2) Role helpers (admins now include super admins) ─────────
create or replace function is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','super_admin'));
$$;

create or replace function is_super() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'super_admin');
$$;

-- ── 3) Signup trigger also stores the chosen username ─────────
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, username)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          new.raw_user_meta_data->>'username')
  on conflict (id) do nothing;
  return new;
end; $$;

-- ── 4) Lock direct profile writes; only super admins may edit rows directly.
--      Everything else flows through the RPCs below (which bypass RLS safely).
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update using (is_super()) with check (is_super());

-- ── 5) Username → email lookup for login (callable before auth) ──
create or replace function get_email_for_username(p_username text) returns text
language sql security definer set search_path = public stable as $$
  select email from profiles where lower(username) = lower(p_username) limit 1;
$$;
grant execute on function get_email_for_username(text) to anon, authenticated;

create or replace function username_available(p_username text) returns boolean
language sql security definer set search_path = public stable as $$
  select not exists (select 1 from profiles where lower(username) = lower(p_username));
$$;
grant execute on function username_available(text) to anon, authenticated;

-- ── 6) Approve / revoke an account ────────────────────────────
--   Any admin may approve regular users; normal admins can't touch admin accounts.
create or replace function set_verification(target uuid, verified boolean) returns void
language plpgsql security definer set search_path = public as $$
declare caller_role text; target_role text;
begin
  select role into caller_role from profiles where id = auth.uid();
  select role into target_role from profiles where id = target;
  if caller_role not in ('admin','super_admin') then raise exception 'Not authorized'; end if;
  if caller_role = 'admin' and target_role in ('admin','super_admin') then
    raise exception 'Normal admins cannot modify admin accounts';
  end if;
  update profiles set is_verified = verified where id = target;
end; $$;
grant execute on function set_verification(uuid, boolean) to authenticated;

-- ── 7) Change a role ──────────────────────────────────────────
--   super_admin: any change. admin: may only promote a plain user to admin.
create or replace function set_role(target uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
declare caller_role text; target_role text;
begin
  if new_role not in ('user','admin','super_admin') then raise exception 'Invalid role'; end if;
  select role into caller_role from profiles where id = auth.uid();
  select role into target_role from profiles where id = target;

  if caller_role = 'super_admin' then
    update profiles set role = new_role,
      is_verified = case when new_role <> 'user' then true else is_verified end
      where id = target;
    return;
  end if;

  if caller_role = 'admin' then
    if target_role <> 'user' or new_role <> 'admin' then
      raise exception 'Normal admins can only promote a user to admin';
    end if;
    update profiles set role = 'admin', is_verified = true where id = target;
    return;
  end if;

  raise exception 'Not authorized';
end; $$;
grant execute on function set_role(uuid, text) to authenticated;

-- ── 8) Make yourself the first super admin (replace the email) ─
--   update profiles set role = 'super_admin' where email = 'you@example.com';


-- ============================================================================
-- == SECTION 04 / 21 :  migration_mobile_number_users.sql
-- ============================================================================

-- Adds an optional mobile number field to user profiles.
alter table public.profiles add column if not exists mobile_number text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, username, mobile_number)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          new.raw_user_meta_data->>'username',
          new.raw_user_meta_data->>'mobile_number')
  on conflict (id) do nothing;
  return new;
end;
$$;


-- ============================================================================
-- == SECTION 05 / 21 :  migration_profile_change_mobile.sql
-- ============================================================================

-- Adds mobile number to the existing profile-change approval flow.
-- Run after schema_users_patch.sql.

alter table public.profile_change_requests add column if not exists current_mobile_number text;
alter table public.profile_change_requests add column if not exists requested_mobile_number text;

drop function if exists public.request_profile_change(text, text, text);
create or replace function public.request_profile_change(
  p_full_name text,
  p_username text,
  p_email text,
  p_mobile_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_id uuid;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid();

  if not found then
    raise exception 'No profile found for current user.';
  end if;

  if coalesce(trim(p_username), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'Username and email are required.';
  end if;

  if exists (
    select 1 from public.profile_change_requests
    where user_id = v_profile.id and status = 'pending'
  ) then
    raise exception 'You already have a pending profile change.';
  end if;

  if lower(coalesce(p_username, '')) <> lower(coalesce(v_profile.username, ''))
     and exists (
       select 1 from public.profiles
       where lower(username) = lower(p_username) and id <> v_profile.id
     ) then
    raise exception 'That username is taken.';
  end if;

  insert into public.profile_change_requests (
    user_id,
    current_full_name, requested_full_name,
    current_username, requested_username,
    current_email, requested_email,
    current_mobile_number, requested_mobile_number
  ) values (
    v_profile.id,
    v_profile.full_name, nullif(trim(p_full_name), ''),
    v_profile.username, trim(p_username),
    v_profile.email, trim(p_email),
    v_profile.mobile_number, nullif(trim(p_mobile_number), '')
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.approve_profile_change_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_req public.profile_change_requests%rowtype;
  v_admin uuid := auth.uid();
begin
  if not public.is_current_user_admin() then
    raise exception 'Only admins can approve profile changes.';
  end if;

  select * into v_req
  from public.profile_change_requests
  where id = p_request and status = 'pending'
  for update;

  if not found then
    raise exception 'Pending request not found.';
  end if;

  if lower(coalesce(v_req.requested_username, '')) <> lower(coalesce(v_req.current_username, ''))
     and exists (
       select 1 from public.profiles
       where lower(username) = lower(v_req.requested_username) and id <> v_req.user_id
     ) then
    raise exception 'That username is taken.';
  end if;

  update public.profiles
  set full_name = v_req.requested_full_name,
      username = v_req.requested_username,
      email = v_req.requested_email,
      mobile_number = v_req.requested_mobile_number
  where id = v_req.user_id;

  if coalesce(v_req.current_email, '') <> coalesce(v_req.requested_email, '') then
    insert into public.profile_email_log(user_id, old_email, new_email, changed_by, source, request_id)
    values (v_req.user_id, v_req.current_email, v_req.requested_email, v_admin, 'admin approval', v_req.id);

    update auth.users
    set email = v_req.requested_email,
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
          || jsonb_build_object('email', v_req.requested_email, 'username', v_req.requested_username, 'full_name', v_req.requested_full_name, 'mobile_number', v_req.requested_mobile_number),
        updated_at = now()
    where id = v_req.user_id;

    update auth.identities
    set identity_data = coalesce(identity_data, '{}'::jsonb)
      || jsonb_build_object('email', v_req.requested_email, 'sub', v_req.user_id::text),
        updated_at = now()
    where user_id = v_req.user_id and provider = 'email';
  end if;

  update public.profile_change_requests
  set status = 'approved', reviewed_by = v_admin, reviewed_at = now()
  where id = v_req.id;
end;
$$;


-- ============================================================================
-- == SECTION 06 / 21 :  migration_incidents.sql
-- ============================================================================

-- migration_incidents.sql
-- Run once in the Supabase SQL editor to add the new incident fields
-- to a database that already has the original schema.

alter table incidents add column if not exists root_cause_other  text;
alter table incidents add column if not exists consequence_other text;
alter table incidents add column if not exists is_anonymous boolean not null default false;
alter table incidents add column if not exists location     text;
alter table incidents add column if not exists occurred_at  timestamptz;


-- ============================================================================
-- == SECTION 07 / 21 :  migration_incident_photos_checklist_logs.sql
-- ============================================================================

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


-- ============================================================================
-- == SECTION 08 / 21 :  migration_report_types_archive.sql
-- ============================================================================

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


-- ============================================================================
-- == SECTION 09 / 21 :  migration_import_excel_logs.sql
-- ============================================================================

-- Allows admins to import archived report logs from the Excel format exported by Logs.
-- Run after schema.sql and migration_report_types_archive.sql.

drop policy if exists inc_admin_insert on public.incidents;
create policy inc_admin_insert on public.incidents
  for insert
  with check (public.is_admin());


-- ============================================================================
-- == SECTION 10 / 21 :  migration_delete_logs.sql
-- ============================================================================

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


-- ============================================================================
-- == SECTION 11 / 21 :  migration_reorderable_content.sql
-- ============================================================================

-- Adds saved ordering for admin-managed content lists.
-- Run once in Supabase before relying on drag-to-reorder persistence.

alter table checklists
  add column if not exists sort_order int not null default 0;

alter table procedures
  add column if not exists sort_order int not null default 0;

alter table documents
  add column if not exists sort_order int not null default 0;


-- ============================================================================
-- == SECTION 12 / 21 :  migration_content_images.sql
-- ============================================================================

-- migration_content_images.sql
-- Gives checklists, courses and procedures an optional "profile image" shown on
-- their library card. Two ways to set it: `image` holds an uploaded picture
-- (data URL), `icon` holds a chosen emoji logo. `image` wins when both are set.
-- Run once in the Supabase SQL editor.

alter table checklists add column if not exists image text;
alter table checklists add column if not exists icon  text;

alter table courses    add column if not exists image text;
alter table courses    add column if not exists icon  text;

alter table procedures add column if not exists image text;
alter table procedures add column if not exists icon  text;


-- ============================================================================
-- == SECTION 13 / 21 :  migration_courses.sql
-- ============================================================================

-- ============================================================
--  migration_courses.sql
--  Adds the "courses" group kind: a reading item with a quiz
--  at the end. Each question carries its own expected answer,
--  the same way checklist items do.
--  Safe to run once in the Supabase SQL editor. Idempotent.
-- ============================================================

-- ------------------------------------------------------------
--  COURSES  (one per row, inside a group of kind 'courses')
--  questions jsonb: [{ id, type, prompt, options[], expected, required, points }]
--  type: 'confirm' | 'choice' | 'multi' | 'text' | 'number'
--    confirm : learner must tick an acknowledgement   → expected = true
--    choice  : one correct option                     → expected = "Option text"
--    multi   : several correct options                → expected = ["A","C"]
--    text    : accepted free-text answers             → expected = { values: ["yes","ok"] }
--    number  : accepted numeric range                 → expected = { min: x, max: y }
-- ------------------------------------------------------------
create table if not exists courses (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references groups (id) on delete cascade,
  title          text not null,
  content        text not null default '',        -- the reading material
  pass_threshold int  not null default 100,        -- percent score needed to pass
  questions      jsonb not null default '[]'::jsonb,
  is_draft       boolean not null default true,
  sort_order     int not null default 0,
  created_by     uuid references profiles (id),
  created_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
--  COURSE SUBMISSIONS  (append-only; every attempt is a row,
--  so retakes and a "passed" history are preserved)
-- ------------------------------------------------------------
create table if not exists course_submissions (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses (id) on delete cascade,
  user_id     uuid not null references profiles (id),
  answers     jsonb not null default '{}'::jsonb,  -- { question_id: answer }
  score       int  not null default 0,             -- 0..100
  passed      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists course_submissions_lookup
  on course_submissions (course_id, user_id, created_at desc);

-- ------------------------------------------------------------
--  COURSE ASSIGNMENTS  (optional admin-to-user assignment)
-- ------------------------------------------------------------
create table if not exists course_assignments (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses (id) on delete cascade,
  user_id     uuid not null references profiles (id) on delete cascade,
  assigned_by uuid references profiles (id),
  assigned_at timestamptz not null default now(),
  due_at      timestamptz,
  status      text not null default 'assigned',
  unique (course_id, user_id)
);
create index if not exists course_assignments_user_idx
  on course_assignments (user_id, assigned_at desc);
create index if not exists course_assignments_course_idx
  on course_assignments (course_id, assigned_at desc);

-- ------------------------------------------------------------
--  ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table courses            enable row level security;
alter table course_submissions enable row level security;
alter table course_assignments enable row level security;

-- courses: any signed-in user can read (the UI hides drafts); admins write
drop policy if exists courses_read on courses;
create policy courses_read on courses for select using (auth.role() = 'authenticated');
drop policy if exists courses_admin on courses;
create policy courses_admin on courses for all using (is_admin()) with check (is_admin());

-- submissions: a user owns their own; admins read all
drop policy if exists csub_own on course_submissions;
create policy csub_own on course_submissions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists csub_admin_read on course_submissions;
create policy csub_admin_read on course_submissions for select using (is_admin());

-- assignments: users read their own; admins manage all
drop policy if exists course_assignments_own_read on course_assignments;
create policy course_assignments_own_read on course_assignments for select using (user_id = auth.uid());
drop policy if exists course_assignments_admin_all on course_assignments;
create policy course_assignments_admin_all on course_assignments for all using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------
--  Optional: create the Courses group now, or add it from the
--  admin UI's "Add group" dialog once the wiring is in place.
-- ------------------------------------------------------------
-- insert into groups (name, icon, kind, sort_order)
--   values ('Courses', '🎓', 'courses', 5) on conflict do nothing;


-- ============================================================================
-- == SECTION 14 / 21 :  migration_course_assignments.sql
-- ============================================================================

-- Adds optional course assignments from admins to users.
-- Safe to run more than once.

create table if not exists public.course_assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  due_at timestamptz,
  status text not null default 'assigned',
  unique (course_id, user_id)
);

create index if not exists course_assignments_user_idx
  on public.course_assignments(user_id, assigned_at desc);
create index if not exists course_assignments_course_idx
  on public.course_assignments(course_id, assigned_at desc);

alter table public.course_assignments enable row level security;

drop policy if exists course_assignments_own_read on public.course_assignments;
create policy course_assignments_own_read on public.course_assignments
  for select using (user_id = auth.uid());

drop policy if exists course_assignments_admin_all on public.course_assignments;
create policy course_assignments_admin_all on public.course_assignments
  for all using (public.is_admin()) with check (public.is_admin());


-- ============================================================================
-- == SECTION 15 / 21 :  migration_checklist_review.sql
-- ============================================================================

-- migration_checklist_review.sql
-- Adds a persisted "reviewed" state to checklist runs so an admin can clear a
-- log that was flagged for attention (missing items, out-of-range answers, or
-- notes). Until reviewed, such a run shows as "Needs attention"; once reviewed
-- it counts as completed everywhere. Run once in the Supabase SQL editor.

alter table checklist_runs add column if not exists reviewed_at timestamptz;
alter table checklist_runs add column if not exists reviewed_by uuid references profiles (id);

-- Security-definer RPC so the permission lives in the database, not just the UI.
-- Any admin-or-above may mark a run reviewed; the worker who filed it cannot.
create or replace function mark_checklist_run_reviewed(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Only admins can mark checklist logs as reviewed.';
  end if;
  update checklist_runs
     set reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_id;
  if not found then
    raise exception 'Checklist log not found.';
  end if;
end; $$;
grant execute on function mark_checklist_run_reviewed(uuid) to authenticated;


-- ============================================================================
-- == SECTION 16 / 21 :  migration_roles_varsling.sql
-- ============================================================================

-- migration_roles_varsling.sql
-- Five-tier role model + confidential "varsling" reports.
-- Run ONCE in the Supabase SQL editor, AFTER the earlier migrations
-- (schema.sql, migration_username_ranks.sql, schema_users_patch.sql,
--  migration_report_types_archive.sql, migration_delete_logs.sql).
--
-- Roles, highest -> lowest authority:
--   sysadmin    - programmers; ALL powers; hidden from everyone below.
--   superuser   - full power (create/delete groups, checklists, archive reports,
--                 permanently delete logs).
--   admin       - full admin overview, but CANNOT archive reports or permanently
--                 delete logs.
--   verneombud  - safety rep; admin app limited to Checklist Logs.
--   user        - worker app only.
--
-- This file is safe to re-run.

-- ════════════════════════════════════════════════════════════════
-- 1) Role rank + helper functions
--    Redefining is_admin()/is_super() means every existing RLS policy and
--    RPC that already calls them inherits the new semantics automatically.
-- ════════════════════════════════════════════════════════════════
create or replace function role_rank(r text) returns int
language sql immutable set search_path = public as $$
  select case r
    when 'sysadmin'   then 4
    when 'superuser'  then 3
    when 'admin'      then 2
    when 'verneombud' then 1
    else 0 end;
$$;

-- "admin and above" — drives groups/checklists/incidents/procedures/etc.
create or replace function is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles
    where id = auth.uid() and role in ('admin','superuser','sysadmin'));
$$;

-- "full power" — archive, permanent delete, direct profile writes. Admins are excluded.
create or replace function is_super() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles
    where id = auth.uid() and role in ('superuser','sysadmin'));
$$;

create or replace function is_sysadmin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'sysadmin');
$$;

-- Who may read checklist logs: safety reps and everyone above them.
create or replace function can_view_checklist_logs() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles
    where id = auth.uid() and role in ('verneombud','admin','superuser','sysadmin'));
$$;

alter table profiles add column if not exists can_access_varsling boolean not null default false;

-- Varsling: must be admin-or-above AND individually granted the flag.
create or replace function can_access_varsling() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles p
    where p.id = auth.uid()
      and p.role in ('admin','superuser','sysadmin')
      and p.can_access_varsling);
$$;

-- Used by schema_users_patch.sql policies/RPCs — realign to "admin and above".
create or replace function public.is_current_user_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and role in ('admin','superuser','sysadmin'));
$$;

-- ════════════════════════════════════════════════════════════════
-- 2) profiles: varsling flag + read policy that hides sys-admins
-- ════════════════════════════════════════════════════════════════
-- Own row always; sys-admins see everyone; admins+ and checklist-log viewers
-- see every NON-sysadmin row (so sys-admins are invisible to everyone below).
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select using (
  id = auth.uid()
  or is_sysadmin()
  or (role <> 'sysadmin' and (is_admin() or can_view_checklist_logs()))
);

-- ════════════════════════════════════════════════════════════════
-- 3) Role / verification management, by rank
--    A caller may act only on a strictly-lower-ranked target, and may assign
--    only a role strictly below their own rank — EXCEPT sys-admins, who may
--    assign any role (including sysadmin) to anyone.
-- ════════════════════════════════════════════════════════════════
create or replace function set_role(target uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
declare caller_role text; target_role text; caller_rank int; target_rank int; new_rank int;
begin
  if new_role not in ('user','verneombud','admin','superuser','sysadmin') then
    raise exception 'Invalid role';
  end if;
  select role into caller_role from profiles where id = auth.uid();
  select role into target_role from profiles where id = target;

  if caller_role = 'sysadmin' then
    update profiles set role = new_role,
      is_verified = case when new_role <> 'user' then true else is_verified end
      where id = target;
    return;
  end if;

  caller_rank := role_rank(caller_role);
  target_rank := role_rank(target_role);
  new_rank    := role_rank(new_role);

  if caller_rank <= target_rank then
    raise exception 'Not authorized to modify this account';
  end if;
  if new_rank >= caller_rank then
    raise exception 'Cannot assign a role at or above your own';
  end if;

  update profiles set role = new_role,
    is_verified = case when new_role <> 'user' then true else is_verified end
    where id = target;
end; $$;
grant execute on function set_role(uuid, text) to authenticated;

-- Approve / revoke account access. Callable on anyone at the caller's own rank
-- or below (but never on yourself); the caller must be admin or above.
create or replace function set_verification(target uuid, verified boolean) returns void
language plpgsql security definer set search_path = public as $$
declare caller_role text; target_role text;
begin
  if target = auth.uid() then raise exception 'You cannot change your own access'; end if;
  select role into caller_role from profiles where id = auth.uid();
  select role into target_role from profiles where id = target;
  if role_rank(caller_role) < 2 then
    raise exception 'Not authorized';                       -- admin and above only
  end if;
  if role_rank(caller_role) < role_rank(target_role) then
    raise exception 'Cannot modify an account above your level';
  end if;
  update profiles set is_verified = verified where id = target;
end; $$;
grant execute on function set_verification(uuid, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4) Grant / revoke varsling access (superusers + sys-admins only)
-- ════════════════════════════════════════════════════════════════
create or replace function set_varsling_access(target uuid, v boolean) returns void
language plpgsql security definer set search_path = public as $$
declare target_role text;
begin
  if not is_super() then
    raise exception 'Only superusers and sys-admins can grant varsling access';
  end if;
  select role into target_role from profiles where id = target;
  if target_role not in ('admin','superuser','sysadmin') then
    raise exception 'Varsling access requires the target to be admin or above';
  end if;
  update profiles set can_access_varsling = v where id = target;
end; $$;
grant execute on function set_varsling_access(uuid, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5) Checklist logs readable by safety reps (additive to admin policy)
-- ════════════════════════════════════════════════════════════════
drop policy if exists runs_checklist_log_read on checklist_runs;
create policy runs_checklist_log_read on checklist_runs
  for select using (can_view_checklist_logs());

-- ════════════════════════════════════════════════════════════════
-- 6) Profile-change-request / email-log policies
--    Re-created to use is_current_user_admin() instead of literal role names
--    (the literals 'admin'/'super_admin' change meaning after the migration).
-- ════════════════════════════════════════════════════════════════
drop policy if exists "Admins can read all profile change requests" on public.profile_change_requests;
create policy "Admins can read all profile change requests"
  on public.profile_change_requests for select using (public.is_current_user_admin());

drop policy if exists "Admins can update profile change requests" on public.profile_change_requests;
create policy "Admins can update profile change requests"
  on public.profile_change_requests for update
  using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop policy if exists "Admins can read all email logs" on public.profile_email_log;
create policy "Admins can read all email logs"
  on public.profile_email_log for select using (public.is_current_user_admin());

drop policy if exists "Admins can insert email logs" on public.profile_email_log;
create policy "Admins can insert email logs"
  on public.profile_email_log for insert with check (public.is_current_user_admin());

-- ════════════════════════════════════════════════════════════════
-- 7) Varsling table (confidential serious reports)
--    Anyone signed in may file one; only granted people may read/handle;
--    only superusers+ may permanently delete.
-- ════════════════════════════════════════════════════════════════
create table if not exists varslinger (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid references profiles (id),   -- null when filed anonymously
  is_anonymous  boolean not null default false,
  title         text not null,
  description   text,
  status        text not null default 'open',     -- open | in_progress | resolved
  handled_by    uuid references profiles (id),
  handled_at    timestamptz,
  resolution    text,
  created_at    timestamptz not null default now()
);
alter table varslinger enable row level security;

drop policy if exists varsling_insert on varslinger;
create policy varsling_insert on varslinger for insert
  with check (auth.role() = 'authenticated'
              and (is_anonymous or reporter_id = auth.uid()));

drop policy if exists varsling_read on varslinger;
create policy varsling_read on varslinger for select using (can_access_varsling());

drop policy if exists varsling_update on varslinger;
create policy varsling_update on varslinger for update
  using (can_access_varsling()) with check (can_access_varsling());

drop policy if exists varsling_delete on varslinger;
create policy varsling_delete on varslinger for delete using (is_super());

create index if not exists varslinger_status_idx on varslinger (status, created_at desc);

-- ════════════════════════════════════════════════════════════════
-- 8) Data migration of existing accounts
--    super_admin -> sysadmin, admin -> superuser (user unchanged).
--    Then make sure the named programmer accounts are sys-admins.
-- ════════════════════════════════════════════════════════════════
update profiles set role = 'sysadmin'  where role = 'super_admin';
update profiles set role = 'superuser' where role = 'admin';
update profiles set role = 'sysadmin'
  where lower(email) in ('giorgiolord28@gmail.com', 'claude@gmail.zz');
-- Everyone with an elevated role counts as approved (revoke can later un-set this).
update profiles set is_verified = true
  where role in ('verneombud', 'admin', 'superuser', 'sysadmin');


-- ============================================================================
-- == SECTION 17 / 21 :  migration_report_form_configs.sql
-- ============================================================================

-- migration_report_form_configs.sql
-- Custom fields for incident, hazard, suggestion, and varsling report forms.

alter table public.incidents
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table public.varslinger
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create table if not exists public.report_form_configs (
  report_type text primary key
    check (report_type in ('incident', 'hazard', 'suggestion', 'varsling')),
  fields jsonb not null default '[]'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.report_form_configs enable row level security;

drop policy if exists report_form_configs_read on public.report_form_configs;
create policy report_form_configs_read on public.report_form_configs
  for select using (auth.uid() is not null);

drop policy if exists report_form_configs_write on public.report_form_configs;
create policy report_form_configs_write on public.report_form_configs
  for all using (public.is_super()) with check (public.is_super());

insert into public.report_form_configs (report_type, fields)
values
  ('incident', '[]'::jsonb),
  ('hazard', '[]'::jsonb),
  ('suggestion', '[]'::jsonb),
  ('varsling', '[]'::jsonb)
on conflict (report_type) do nothing;


-- ============================================================================
-- == SECTION 18 / 21 :  migration_sysadmin_guard.sql
-- ============================================================================

-- migration_sysadmin_guard.sql
-- Two-person rule for sys-admin ↔ sys-admin actions.
-- Run ONCE in the Supabase SQL editor, AFTER migration_roles_varsling.sql.
--
-- A sys-admin can no longer directly revoke or change the role of another sys-admin.
-- Such an action must go through request_sysadmin_action, which records a reason and
-- SUSPENDS both the initiator and the target until a THIRD sys-admin resolves it
-- (uphold = target stays suspended / role applied, initiator freed; revert = the
-- opposite). Suspended accounts are locked out of both apps and can do nothing until
-- another sys-admin lifts the suspension. Enforced in the DB because a hacked
-- sys-admin holds a valid session.
--
-- Safe to re-run.

-- ════════════════════════════════════════════════════════════════
-- 1) Suspension state + helper
-- ════════════════════════════════════════════════════════════════
alter table profiles add column if not exists is_suspended    boolean not null default false;
alter table profiles add column if not exists suspended_at     timestamptz;
alter table profiles add column if not exists suspended_reason text;

create or replace function is_suspended() returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((select is_suspended from profiles where id = auth.uid()), false);
$$;

-- ════════════════════════════════════════════════════════════════
-- 2) Case table — one row per pending/closed sys-admin dispute
-- ════════════════════════════════════════════════════════════════
create table if not exists sysadmin_cases (
  id           uuid primary key default gen_random_uuid(),
  initiator_id uuid not null references profiles (id),
  target_id    uuid not null references profiles (id),
  action_type  text not null,                 -- 'revoke' | 'role_change'
  new_role     text,                          -- for role_change
  reason       text not null,
  status       text not null default 'pending', -- pending | upheld | reverted
  resolved_by  uuid references profiles (id),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
alter table sysadmin_cases enable row level security;

-- Only sys-admins may read cases; all writes go through the SECURITY DEFINER RPCs.
drop policy if exists sysadmin_cases_read on sysadmin_cases;
create policy sysadmin_cases_read on sysadmin_cases for select using (is_sysadmin());

-- ════════════════════════════════════════════════════════════════
-- 3) Re-create set_role / set_verification with the suspension guard
--    and the sys-admin ↔ sys-admin block (overrides the roles migration).
-- ════════════════════════════════════════════════════════════════
create or replace function set_role(target uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
declare caller_role text; target_role text; caller_rank int; target_rank int; new_rank int;
begin
  if is_suspended() then raise exception 'Your account is suspended'; end if;
  if new_role not in ('user','verneombud','admin','superuser','sysadmin') then
    raise exception 'Invalid role';
  end if;
  select role into caller_role from profiles where id = auth.uid();
  select role into target_role from profiles where id = target;

  -- A sys-admin may not directly change another sys-admin's role.
  if caller_role = 'sysadmin' and target_role = 'sysadmin' and target <> auth.uid() then
    raise exception 'Use the sys-admin review process for actions on another sys-admin';
  end if;

  if caller_role = 'sysadmin' then
    update profiles set role = new_role,
      is_verified = case when new_role <> 'user' then true else is_verified end
      where id = target;
    return;
  end if;

  caller_rank := role_rank(caller_role);
  target_rank := role_rank(target_role);
  new_rank    := role_rank(new_role);
  if caller_rank <= target_rank then raise exception 'Not authorized to modify this account'; end if;
  if new_rank >= caller_rank then raise exception 'Cannot assign a role at or above your own'; end if;

  update profiles set role = new_role,
    is_verified = case when new_role <> 'user' then true else is_verified end
    where id = target;
end; $$;
grant execute on function set_role(uuid, text) to authenticated;

create or replace function set_verification(target uuid, verified boolean) returns void
language plpgsql security definer set search_path = public as $$
declare caller_role text; target_role text;
begin
  if is_suspended() then raise exception 'Your account is suspended'; end if;
  if target = auth.uid() then raise exception 'You cannot change your own access'; end if;
  select role into caller_role from profiles where id = auth.uid();
  select role into target_role from profiles where id = target;

  -- A sys-admin may not directly revoke another sys-admin.
  if caller_role = 'sysadmin' and target_role = 'sysadmin' then
    raise exception 'Use the sys-admin review process for actions on another sys-admin';
  end if;

  if role_rank(caller_role) < 2 then raise exception 'Not authorized'; end if;
  if role_rank(caller_role) < role_rank(target_role) then
    raise exception 'Cannot modify an account above your level';
  end if;
  update profiles set is_verified = verified where id = target;
end; $$;
grant execute on function set_verification(uuid, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4) Open a sys-admin case (the only path to act on a fellow sys-admin)
-- ════════════════════════════════════════════════════════════════
create or replace function request_sysadmin_action(
  target uuid, action_type text, new_role text, reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare caller_role text; target_role text; case_id uuid;
begin
  if is_suspended() then raise exception 'Your account is suspended'; end if;
  if action_type not in ('revoke','role_change') then raise exception 'Invalid action'; end if;
  if coalesce(trim(reason), '') = '' then raise exception 'A reason is required'; end if;
  if target = auth.uid() then raise exception 'You cannot open a case on yourself'; end if;
  if action_type = 'role_change' and new_role not in ('user','verneombud','admin','superuser','sysadmin') then
    raise exception 'Invalid role';
  end if;
  select role into caller_role from profiles where id = auth.uid();
  select role into target_role from profiles where id = target;
  if caller_role <> 'sysadmin' or target_role <> 'sysadmin' then
    raise exception 'This process is only for actions between sys-admins';
  end if;

  insert into sysadmin_cases (initiator_id, target_id, action_type, new_role, reason)
  values (auth.uid(), target, action_type, new_role, trim(reason))
  returning id into case_id;

  update profiles set is_suspended = true, suspended_at = now(),
         suspended_reason = 'Sys-admin review pending'
   where id in (auth.uid(), target);

  return case_id;
end; $$;
grant execute on function request_sysadmin_action(uuid, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5) Resolve a case — a THIRD sys-admin only
-- ════════════════════════════════════════════════════════════════
create or replace function resolve_sysadmin_case(case_id uuid, verdict text) returns void
language plpgsql security definer set search_path = public as $$
declare c sysadmin_cases%rowtype;
begin
  if is_suspended() then raise exception 'Your account is suspended'; end if;
  if not is_sysadmin() then raise exception 'Only sys-admins can resolve cases'; end if;
  if verdict not in ('uphold','revert') then raise exception 'Invalid verdict'; end if;

  select * into c from sysadmin_cases where id = case_id and status = 'pending' for update;
  if not found then raise exception 'Pending case not found'; end if;
  if auth.uid() in (c.initiator_id, c.target_id) then
    raise exception 'You are involved in this case and cannot resolve it';
  end if;

  if verdict = 'uphold' then
    update profiles set is_suspended = false, suspended_at = null, suspended_reason = null
      where id = c.initiator_id;                       -- initiator cleared
    if c.action_type = 'role_change' then
      update profiles set role = c.new_role,
        is_verified = case when c.new_role <> 'user' then true else is_verified end
        where id = c.target_id;                        -- target keeps suspension, role applied
    end if;
  else  -- revert
    update profiles set is_suspended = false, suspended_at = null, suspended_reason = null
      where id = c.target_id;                          -- target cleared, initiator stays suspended
  end if;

  update sysadmin_cases set status = case when verdict = 'uphold' then 'upheld' else 'reverted' end,
         resolved_by = auth.uid(), resolved_at = now()
   where id = case_id;
end; $$;
grant execute on function resolve_sysadmin_case(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════
-- 6) Recovery — any free sys-admin may lift a suspension
-- ════════════════════════════════════════════════════════════════
create or replace function set_suspension(target uuid, suspended boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if is_suspended() then raise exception 'Your account is suspended'; end if;
  if not is_sysadmin() then raise exception 'Only sys-admins can change suspension'; end if;
  update profiles
     set is_suspended = suspended,
         suspended_at = case when suspended then now() else null end,
         suspended_reason = case when suspended then suspended_reason else null end
   where id = target;
end; $$;
grant execute on function set_suspension(uuid, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════
-- 7) Harden the other sensitive RPCs against a suspended caller
-- ════════════════════════════════════════════════════════════════
create or replace function set_varsling_access(target uuid, v boolean) returns void
language plpgsql security definer set search_path = public as $$
declare target_role text;
begin
  if is_suspended() then raise exception 'Your account is suspended'; end if;
  if not is_super() then raise exception 'Only superusers and sys-admins can grant varsling access'; end if;
  select role into target_role from profiles where id = target;
  if target_role not in ('admin','superuser','sysadmin') then
    raise exception 'Varsling access requires the target to be admin or above';
  end if;
  update profiles set can_access_varsling = v where id = target;
end; $$;
grant execute on function set_varsling_access(uuid, boolean) to authenticated;

create or replace function archive_report(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if is_suspended() then raise exception 'Your account is suspended'; end if;
  if not is_super() then raise exception 'Only superusers and above can archive reports.'; end if;
  update incidents set archived = true, archived_at = now(), archived_by = auth.uid()
   where id = p_id and status = 'resolved' and archived = false;
  if not found then raise exception 'Report not found, not resolved, or already archived.'; end if;
end; $$;
grant execute on function archive_report(uuid) to authenticated;

create or replace function unarchive_report(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if is_suspended() then raise exception 'Your account is suspended'; end if;
  if not is_super() then raise exception 'Only superusers and above can unarchive reports.'; end if;
  update incidents set archived = false, archived_at = null, archived_by = null
   where id = p_id and archived = true;
  if not found then raise exception 'Archived report not found.'; end if;
end; $$;
grant execute on function unarchive_report(uuid) to authenticated;

create or replace function delete_report(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if is_suspended() then raise exception 'Your account is suspended'; end if;
  if not is_super() then raise exception 'Only superusers and above can delete reports.'; end if;
  delete from incidents where id = p_id and archived = true;
  if not found then raise exception 'Archived report not found.'; end if;
end; $$;
grant execute on function delete_report(uuid) to authenticated;

create or replace function delete_checklist_run(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if is_suspended() then raise exception 'Your account is suspended'; end if;
  if not is_super() then raise exception 'Only superusers and above can delete checklist logs.'; end if;
  delete from checklist_runs where id = p_id;
  if not found then raise exception 'Checklist log not found.'; end if;
end; $$;
grant execute on function delete_checklist_run(uuid) to authenticated;


-- ============================================================================
-- == SECTION 19 / 21 :  migration_group_delete_requests.sql
-- ============================================================================

-- migration_group_delete_requests.sql
-- Hidden-group permanent delete requests.
-- Run ONCE in Supabase SQL editor, after the role migrations.
-- Safe to re-run.

create table if not exists public.group_delete_requests (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid references public.groups(id) on delete set null,
  group_name   text not null,
  requested_by uuid not null references public.profiles(id),
  reason       text not null,
  status       text not null default 'pending',
  resolved_by  uuid references public.profiles(id),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

create unique index if not exists group_delete_requests_one_pending_per_group
  on public.group_delete_requests(group_id)
  where status = 'pending' and group_id is not null;

alter table public.group_delete_requests enable row level security;

drop policy if exists group_delete_requests_read on public.group_delete_requests;
create policy group_delete_requests_read on public.group_delete_requests
  for select using (public.is_admin());

drop policy if exists group_delete_requests_insert on public.group_delete_requests;
create policy group_delete_requests_insert on public.group_delete_requests
  for insert with check (public.is_admin());

drop policy if exists group_delete_requests_update on public.group_delete_requests;
create policy group_delete_requests_update on public.group_delete_requests
  for update using (public.is_super()) with check (public.is_super());

-- Admins may still create/update groups, but permanent delete is reserved for
-- superusers/sysadmins or the SECURITY DEFINER approval RPC below.
drop policy if exists groups_admin on public.groups;
drop policy if exists groups_admin_insert on public.groups;
create policy groups_admin_insert on public.groups
  for insert with check (public.is_admin());
drop policy if exists groups_admin_update on public.groups;
create policy groups_admin_update on public.groups
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists groups_super_delete on public.groups;
create policy groups_super_delete on public.groups
  for delete using (public.is_super());

create or replace function public.request_group_delete(target uuid, delete_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  g public.groups%rowtype;
  request_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can request group deletion';
  end if;
  if public.is_super() then
    raise exception 'Superusers can delete groups directly';
  end if;
  if coalesce(trim(delete_reason), '') = '' then
    raise exception 'A reason is required';
  end if;

  select * into g from public.groups where id = target;
  if not found then
    raise exception 'Group not found';
  end if;

  select id into request_id
    from public.group_delete_requests
   where group_id = target and status = 'pending'
   limit 1;

  if request_id is null then
    insert into public.group_delete_requests (group_id, group_name, requested_by, reason)
    values (target, g.name, auth.uid(), trim(delete_reason))
    returning id into request_id;
  else
    update public.group_delete_requests
       set requested_by = auth.uid(),
           reason = trim(delete_reason),
           created_at = now()
     where id = request_id;
  end if;

  return request_id;
end; $$;
grant execute on function public.request_group_delete(uuid, text) to authenticated;

create or replace function public.delete_group_permanently(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super() then
    raise exception 'Only superusers and sysadmins can permanently delete groups';
  end if;

  update public.group_delete_requests
     set status = 'approved',
         resolved_by = auth.uid(),
         resolved_at = now()
   where group_id = target and status = 'pending';

  delete from public.groups where id = target;
  if not found then
    raise exception 'Group not found';
  end if;
end; $$;
grant execute on function public.delete_group_permanently(uuid) to authenticated;

create or replace function public.approve_group_delete_request(request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.group_delete_requests%rowtype;
begin
  if not public.is_super() then
    raise exception 'Only superusers and sysadmins can approve group deletion';
  end if;

  select * into r
    from public.group_delete_requests
   where id = request_id and status = 'pending'
   for update;
  if not found then
    raise exception 'Pending request not found';
  end if;

  update public.group_delete_requests
     set status = 'approved',
         resolved_by = auth.uid(),
         resolved_at = now()
   where id = request_id;

  if r.group_id is not null then
    delete from public.groups where id = r.group_id;
  end if;
end; $$;
grant execute on function public.approve_group_delete_request(uuid) to authenticated;


-- ============================================================================
-- == SECTION 20 / 21 :  migration_varsling_insert_fix.sql
-- ============================================================================

-- Fix: filing a varsling (whistleblowing report) failed in the worker app with
--   "new row violates row-level security policy for table varslinger" (code 42501).
--
-- Diagnosis: the varslinger table exists and has RLS enabled, but the permissive
-- INSERT policy from migration_roles_varsling.sql is not active in the database
-- (its policy section was never applied), so RLS defaults to deny and NO logged-in
-- user can file a varsling. Reads on other tables that use auth.role()='authenticated'
-- work fine, and incidents inserts (reporter_id = auth.uid()) work fine, which
-- isolates the problem to this one missing/ineffective policy.
--
-- This re-creates the policy. The gate uses auth.uid() (matches the working
-- incidents policy and is robust): any authenticated user may file. A named
-- varsling must carry their own id as reporter_id; an anonymous one carries a
-- null reporter_id (is_anonymous = true). Safe to run more than once.

alter table public.varslinger enable row level security;

drop policy if exists varsling_insert on public.varslinger;
create policy varsling_insert on public.varslinger
  for insert to authenticated
  with check (
    auth.uid() is not null
    and (is_anonymous or reporter_id = auth.uid())
  );

-- After running, verify the policy is present:
--   select policyname, cmd, roles, with_check
--   from pg_policies where tablename = 'varslinger';


-- ============================================================================
-- == SECTION 21 / 21 :  migration_dedupe_default_groups.sql
-- ============================================================================

-- Optional cleanup for duplicated default groups.
-- Run this once if the home screen has duplicate Checklists/Reports/Documentation groups.
-- It keeps the oldest group for each default kind/name pair and removes only empty exact default duplicates.

with default_groups as (
  select id,
         row_number() over (
           partition by kind, lower(name)
           order by sort_order nulls last, created_at, id
         ) as rn
  from groups
  where lower(name) in ('checklists', 'reports', 'documents', 'documentation', 'procedures')
)
delete from groups
where id in (select id from default_groups where rn > 1)
  and not exists (select 1 from checklists c where c.group_id = groups.id)
  and not exists (select 1 from procedures p where p.group_id = groups.id)
  and not exists (select 1 from documents d where d.group_id = groups.id);

-- Future-safe default seed pattern. Re-run only if a default group is missing.
insert into groups (name, kind, sort_order)
select v.name, v.kind, v.sort_order
from (values
  ('Checklists', 'checklist', 1),
  ('Reports', 'reports', 2),
  ('Documentation', 'documents', 3)
) as v(name, kind, sort_order)
where not exists (
  select 1 from groups g
  where lower(g.name) = lower(v.name) and g.kind = v.kind
);
