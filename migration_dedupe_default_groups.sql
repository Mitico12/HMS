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
