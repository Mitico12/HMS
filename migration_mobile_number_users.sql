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
