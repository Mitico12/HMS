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
