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
--  ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table courses            enable row level security;
alter table course_submissions enable row level security;

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

-- ------------------------------------------------------------
--  Optional: create the Courses group now, or add it from the
--  admin UI's "Add group" dialog once the wiring is in place.
-- ------------------------------------------------------------
-- insert into groups (name, icon, kind, sort_order)
--   values ('Courses', '🎓', 'courses', 5) on conflict do nothing;
