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

create or replace function public.request_profile_change(
  p_full_name text,
  p_username text,
  p_email text
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
    current_email, requested_email
  ) values (
    v_profile.id,
    v_profile.full_name, nullif(trim(p_full_name), ''),
    v_profile.username, trim(p_username),
    v_profile.email, trim(p_email)
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
      email = v_req.requested_email
  where id = v_req.user_id;

  if coalesce(v_req.current_email, '') <> coalesce(v_req.requested_email, '') then
    insert into public.profile_email_log(user_id, old_email, new_email, changed_by, source, request_id)
    values (v_req.user_id, v_req.current_email, v_req.requested_email, v_admin, 'admin approval', v_req.id);

    -- Keep email login aligned with public.profiles.email.
    -- If your Supabase project disallows direct auth schema updates, replace this part with an Edge Function using the service role key.
    update auth.users
    set email = v_req.requested_email,
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
          || jsonb_build_object('email', v_req.requested_email, 'username', v_req.requested_username, 'full_name', v_req.requested_full_name),
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
