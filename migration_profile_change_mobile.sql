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
