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
