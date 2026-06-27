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
  insert into profiles (id, email, full_name, username)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          new.raw_user_meta_data->>'username')
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
  created_at  timestamptz not null default now()
);

-- One row per user per checklist; rewritten on every tick for traceability.
create table if not exists checklist_runs (
  id            uuid primary key default gen_random_uuid(),
  checklist_id  uuid not null references checklists (id) on delete cascade,
  user_id       uuid not null references profiles (id),
  checked       jsonb not null default '{}'::jsonb,   -- { item_id: { done: true, at: iso } }
  completed     boolean not null default false,
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
  uploaded_by   uuid references profiles (id),
  created_at    timestamptz not null default now()
);

-- ============================================================
--  STORAGE
--  Create a bucket named 'documents' (private) in the Storage UI,
--  or uncomment the line below.
-- ============================================================
-- insert into storage.buckets (id, name, public) values ('documents','documents', false) on conflict do nothing;

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
insert into groups (name, icon, kind, sort_order) values
  ('Checklists',    '✅', 'checklist',  1),
  ('Reports',       '⚠️', 'reports',    2),
  ('Documentation', '📄', 'documents',  3)
on conflict do nothing;

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
