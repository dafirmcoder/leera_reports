-- ============================================================
--  LEERA END-OF-UNIT REPORTS  —  Supabase schema  (v2)
--  Multi-class, multi-teacher, roles.
--
--  Run this whole file in the Supabase SQL Editor.
--  (Dashboard > SQL Editor > New query > paste > Run)
--
--  Roles:
--    pending                : no access until assigned by an admin
--    director               : read-only (whole school)
--    head_of_school         : read-only + manage users/roles/accounts + school settings
--    curriculum_coordinator : read-only + assign roles
--    homeroom_teacher       : own class -> students, marks, reports, assign subject teachers
--    subject_teacher        : marks + reports for their assigned classes/subjects
-- ============================================================

-- ------------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------------

create table if not exists public.schools (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null default 'Leera International School',
  motto               text not null default '',
  academic_year       text not null default '2026/2027',
  term                text not null default '1',
  footer_text         text not null default 'Email: info@leeraschool.ac.tz   |   Website: www.leeraschool.ac.tz   |   Contact: +255776047665',
  footer_color        text not null default '#1F8A5F',
  show_school_logo    boolean not null default true,
  show_cambridge_logo boolean not null default true,
  created_at          timestamptz not null default now()
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text not null default '',
  role       text not null default 'pending'
             check (role in ('pending','director','head_of_school','curriculum_coordinator','homeroom_teacher','subject_teacher')),
  additional_roles text[] not null default '{}',
  school_id  uuid references public.schools (id) on delete set null,
  class_id   uuid,                                  -- homeroom teacher's class
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools (id) on delete cascade,
  name                text not null,
  homeroom_teacher_id uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now()
);
-- back-reference from profiles.class_id to classes
alter table public.profiles
  drop constraint if exists profiles_class_id_fkey;
alter table public.profiles
  add constraint profiles_class_id_fkey
  foreign key (class_id) references public.classes (id) on delete set null;

create table if not exists public.subjects (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  name        text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.students (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes (id) on delete cascade,
  student_no   text not null,
  admission_no text not null default '',
  full_name    text not null,
  gender       text not null default '',
  created_at   timestamptz not null default now(),
  unique (class_id, student_no)
);

create table if not exists public.unit_tests (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  subject_id  uuid not null references public.subjects (id) on delete cascade,
  created_by  uuid not null default auth.uid() references auth.users (id),
  title       text not null,
  test_date   date not null default current_date,
  max_mark    numeric not null default 100,
  created_at  timestamptz not null default now()
);

create table if not exists public.scores (
  id            uuid primary key default gen_random_uuid(),
  unit_test_id  uuid not null references public.unit_tests (id) on delete cascade,
  student_id    uuid not null references public.students (id) on delete cascade,
  score         numeric,
  unique (unit_test_id, student_id)
);

create table if not exists public.class_subject_teachers (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  subject_id  uuid not null references public.subjects (id) on delete cascade,
  teacher_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (class_id, subject_id, teacher_id)
);

-- ------------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------------

create index if not exists profiles_school_idx   on public.profiles (school_id);
create index if not exists classes_school_idx    on public.classes (school_id);
create index if not exists subjects_school_idx   on public.subjects (school_id);
create index if not exists students_class_idx    on public.students (class_id);
create index if not exists unit_tests_class_idx  on public.unit_tests (class_id);
create index if not exists unit_tests_subj_idx   on public.unit_tests (subject_id);
create index if not exists scores_test_idx       on public.scores (unit_test_id);
create index if not exists scores_student_idx    on public.scores (student_id);
create index if not exists cst_class_idx         on public.class_subject_teachers (class_id);
create index if not exists cst_teacher_idx       on public.class_subject_teachers (teacher_id);

-- ------------------------------------------------------------------
-- Helper functions (used by the RLS policies)
-- ------------------------------------------------------------------

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.has_role(required_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select required_role = role or required_role = any(coalesce(additional_roles, '{}'))
  from public.profiles where id = auth.uid();
$$;

create or replace function public.my_school()
returns uuid language sql stable security definer set search_path = public as $$
  select school_id from public.profiles where id = auth.uid();
$$;

create or replace function public.my_class()
returns uuid language sql stable security definer set search_path = public as $$
  select class_id from public.profiles where id = auth.uid();
$$;

create or replace function public.assigned_class_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select class_id from public.class_subject_teachers where teacher_id = auth.uid();
$$;

create or replace function public.assigned_class_subjects(p_class uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select subject_id from public.class_subject_teachers
  where teacher_id = auth.uid() and class_id = p_class;
$$;

-- ------------------------------------------------------------------
-- Bootstrap: first user becomes Head of School and gets a school;
-- later users start as 'pending'.
-- ------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_school uuid;
  v_count  int;
begin
  select count(*) into v_count from public.profiles;
  if v_count = 0 then
    insert into public.schools (name) values ('Leera International School')
      returning id into v_school;
    insert into public.profiles (id, email, full_name, role, school_id)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      'head_of_school',
      v_school
    );
  else
    -- Self-registered users belong to the existing school while pending so
    -- school administrators can find and approve them.
    select id into v_school from public.schools order by created_at limit 1;
    insert into public.profiles (id, email, full_name, role, school_id)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      'pending',
      v_school
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------------

alter table public.schools                enable row level security;
alter table public.profiles               enable row level security;
alter table public.classes                enable row level security;
alter table public.subjects               enable row level security;
alter table public.students               enable row level security;
alter table public.unit_tests             enable row level security;
alter table public.scores                 enable row level security;
alter table public.class_subject_teachers enable row level security;

-- ---- schools ----
drop policy if exists schools_select on public.schools;
create policy schools_select on public.schools for select using (id = public.my_school());
drop policy if exists schools_update on public.schools;
create policy schools_update on public.schools for update
  using (public.my_role() = 'head_of_school' and id = public.my_school())
  with check (public.my_role() = 'head_of_school' and id = public.my_school());

-- ---- profiles ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (
    id = auth.uid()
    or school_id = public.my_school()
    -- Support pending profiles created before the school-assignment fix.
    or (
      role = 'pending'
      and school_id is null
      and public.my_role() in ('head_of_school', 'curriculum_coordinator')
    )
  );
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (
  id = auth.uid()                                            -- self (name)
  or (
    public.my_role() in ('head_of_school','curriculum_coordinator')
    and (school_id = public.my_school() or (role = 'pending' and school_id is null))
  )
) with check (
  id = auth.uid()
  or (
    public.my_role() in ('head_of_school','curriculum_coordinator')
    and school_id = public.my_school()
  )
);

-- ---- classes ----
drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes for select using (
  school_id = public.my_school()
  and (
    public.my_role() in ('director','head_of_school','curriculum_coordinator')
    or (public.my_role() = 'homeroom_teacher' and id = public.my_class())
    or (public.my_role() = 'subject_teacher' and id in (select public.assigned_class_ids()))
  )
);
drop policy if exists classes_insert on public.classes;
create policy classes_insert on public.classes for insert
  with check (public.my_role() = 'head_of_school' and school_id = public.my_school());
drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes for update
  using (public.my_role() = 'head_of_school' and school_id = public.my_school())
  with check (public.my_role() = 'head_of_school' and school_id = public.my_school());
drop policy if exists classes_delete on public.classes;
create policy classes_delete on public.classes for delete
  using (public.my_role() = 'head_of_school' and school_id = public.my_school());

-- ---- subjects ----
drop policy if exists subjects_select on public.subjects;
create policy subjects_select on public.subjects for select using (school_id = public.my_school());
drop policy if exists subjects_insert on public.subjects;
create policy subjects_insert on public.subjects for insert
  with check (public.my_role() in ('head_of_school','curriculum_coordinator') and school_id = public.my_school());
drop policy if exists subjects_update on public.subjects;
create policy subjects_update on public.subjects for update
  using (public.my_role() in ('head_of_school','curriculum_coordinator') and school_id = public.my_school())
  with check (public.my_role() in ('head_of_school','curriculum_coordinator') and school_id = public.my_school());
drop policy if exists subjects_delete on public.subjects;
create policy subjects_delete on public.subjects for delete
  using (public.my_role() in ('head_of_school','curriculum_coordinator') and school_id = public.my_school());

-- ---- students ----
drop policy if exists students_select on public.students;
create policy students_select on public.students for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.my_role() in ('director','head_of_school','curriculum_coordinator')
    or (public.my_role() = 'homeroom_teacher' and class_id = public.my_class())
    or (public.my_role() = 'subject_teacher' and class_id in (select public.assigned_class_ids()))
  )
);
drop policy if exists students_insert on public.students;
create policy students_insert on public.students for insert
  with check (public.my_role() = 'homeroom_teacher' and class_id = public.my_class());
drop policy if exists students_update on public.students;
create policy students_update on public.students for update
  using (public.my_role() = 'homeroom_teacher' and class_id = public.my_class())
  with check (public.my_role() = 'homeroom_teacher' and class_id = public.my_class());
drop policy if exists students_delete on public.students;
create policy students_delete on public.students for delete
  using (public.my_role() = 'homeroom_teacher' and class_id = public.my_class());

-- ---- unit_tests ----
drop policy if exists unit_tests_select on public.unit_tests;
create policy unit_tests_select on public.unit_tests for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.my_role() in ('director','head_of_school','curriculum_coordinator')
    or (public.my_role() = 'homeroom_teacher' and class_id = public.my_class())
    or (
      public.my_role() = 'subject_teacher'
      and class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
  )
);
drop policy if exists unit_tests_insert on public.unit_tests;
create policy unit_tests_insert on public.unit_tests for insert with check (
  (public.my_role() = 'homeroom_teacher' and class_id = public.my_class())
  or (
    public.my_role() = 'subject_teacher'
    and class_id in (select public.assigned_class_ids())
    and subject_id in (select public.assigned_class_subjects(class_id))
  )
);
drop policy if exists unit_tests_update on public.unit_tests;
create policy unit_tests_update on public.unit_tests for update
  using (
    (public.my_role() = 'homeroom_teacher' and class_id = public.my_class())
    or (
      public.my_role() = 'subject_teacher'
      and class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
  )
  with check (
    (public.my_role() = 'homeroom_teacher' and class_id = public.my_class())
    or (
      public.my_role() = 'subject_teacher'
      and class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
  );
drop policy if exists unit_tests_delete on public.unit_tests;
create policy unit_tests_delete on public.unit_tests for delete using (
  (public.my_role() = 'homeroom_teacher' and class_id = public.my_class())
  or (
    public.my_role() = 'subject_teacher'
    and class_id in (select public.assigned_class_ids())
    and subject_id in (select public.assigned_class_subjects(class_id))
  )
);

-- ---- scores ----
drop policy if exists scores_select on public.scores;
create policy scores_select on public.scores for select using (
  exists (
    select 1 from public.unit_tests t
    join public.classes c on c.id = t.class_id
    where t.id = unit_test_id and c.school_id = public.my_school()
  )
  and (
    public.my_role() in ('director','head_of_school','curriculum_coordinator')
    or (
      public.my_role() = 'homeroom_teacher'
      and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class())
    )
    or (
      public.my_role() = 'subject_teacher'
      and exists (
        select 1 from public.unit_tests t
        where t.id = unit_test_id
          and t.class_id in (select public.assigned_class_ids())
          and t.subject_id in (select public.assigned_class_subjects(t.class_id))
      )
    )
  )
);
drop policy if exists scores_insert on public.scores;
create policy scores_insert on public.scores for insert with check (
  (
    public.my_role() = 'homeroom_teacher'
    and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class())
  )
  or (
    public.my_role() = 'subject_teacher'
    and exists (
      select 1 from public.unit_tests t
      where t.id = unit_test_id
        and t.class_id in (select public.assigned_class_ids())
        and t.subject_id in (select public.assigned_class_subjects(t.class_id))
    )
  )
);
drop policy if exists scores_update on public.scores;
create policy scores_update on public.scores for update
  using (
    (public.my_role() = 'homeroom_teacher'
      and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class()))
    or (public.my_role() = 'subject_teacher'
      and exists (
        select 1 from public.unit_tests t
        where t.id = unit_test_id
          and t.class_id in (select public.assigned_class_ids())
          and t.subject_id in (select public.assigned_class_subjects(t.class_id))
      ))
  )
  with check (
    (public.my_role() = 'homeroom_teacher'
      and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class()))
    or (public.my_role() = 'subject_teacher'
      and exists (
        select 1 from public.unit_tests t
        where t.id = unit_test_id
          and t.class_id in (select public.assigned_class_ids())
          and t.subject_id in (select public.assigned_class_subjects(t.class_id))
      ))
  );
drop policy if exists scores_delete on public.scores;
create policy scores_delete on public.scores for delete using (
  (public.my_role() = 'homeroom_teacher'
    and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class()))
  or (public.my_role() = 'subject_teacher'
    and exists (
      select 1 from public.unit_tests t
      where t.id = unit_test_id
        and t.class_id in (select public.assigned_class_ids())
        and t.subject_id in (select public.assigned_class_subjects(t.class_id))
    ))
);

-- ---- class_subject_teachers ----
drop policy if exists cst_select on public.class_subject_teachers;
create policy cst_select on public.class_subject_teachers for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.my_role() in ('director','head_of_school','curriculum_coordinator')
    or (public.my_role() = 'homeroom_teacher' and class_id = public.my_class())
    or teacher_id = auth.uid()
  )
);
drop policy if exists cst_insert on public.class_subject_teachers;
create policy cst_insert on public.class_subject_teachers for insert with check (
  public.my_role() = 'head_of_school'
  or (public.my_role() = 'homeroom_teacher' and class_id = public.my_class())
);
drop policy if exists cst_delete on public.class_subject_teachers;
create policy cst_delete on public.class_subject_teachers for delete using (
  public.my_role() = 'head_of_school'
  or (public.my_role() = 'homeroom_teacher' and class_id = public.my_class())
);
