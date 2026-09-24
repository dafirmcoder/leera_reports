-- ==============================================================================
-- Migration: Planning, Curriculum, Timetable, Work Plans & Lesson Plans
-- ==============================================================================

-- 1. Curriculum Schemes
create table if not exists public.curriculum_schemes (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid references public.schools (id) on delete cascade,
  framework    text not null check (framework in ('CAMBRIDGE_PRIMARY', 'CAMBRIDGE_LOWER_SECONDARY', 'CAMBRIDGE_IGCSE', 'CAMBRIDGE_AS_A_LEVEL', 'NATIONAL', 'OTHER')),
  subject_code text not null default '',
  subject_name text not null,
  year_group   text not null default '',
  title        text not null,
  syllabus_years text not null default '2023-2027',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_curriculum_schemes_fw on public.curriculum_schemes (framework, subject_name);

-- 2. Curriculum Topics (and Challenges for Global Perspectives)
create table if not exists public.curriculum_topics (
  id             uuid primary key default gen_random_uuid(),
  scheme_id      uuid not null references public.curriculum_schemes (id) on delete cascade,
  code           text not null default '',
  title          text not null,
  sequence       int not null default 1,
  is_challenge   boolean not null default false,
  description    text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists idx_curriculum_topics_scheme on public.curriculum_topics (scheme_id, sequence);

-- 3. Curriculum Objectives
create table if not exists public.curriculum_objectives (
  id              uuid primary key default gen_random_uuid(),
  scheme_id       uuid not null references public.curriculum_schemes (id) on delete cascade,
  topic_id        uuid references public.curriculum_topics (id) on delete set null,
  code            text not null,
  text            text not null,
  subtopic        text not null default '',
  challenge_title text not null default '',
  sequence        int not null default 1,
  created_at      timestamptz not null default now(),
  unique (scheme_id, code)
);

create index if not exists idx_curriculum_objectives_scheme on public.curriculum_objectives (scheme_id, code);
create index if not exists idx_curriculum_objectives_topic on public.curriculum_objectives (topic_id);

-- 4. Teacher Timetables & Schedule Slots
create table if not exists public.teacher_timetables (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid references public.schools (id) on delete cascade,
  teacher_id    uuid not null references public.profiles (id) on delete cascade,
  file_name     text not null default '',
  academic_year text not null default '',
  semester      text not null default '1',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.teacher_schedule_slots (
  id            uuid primary key default gen_random_uuid(),
  timetable_id  uuid not null references public.teacher_timetables (id) on delete cascade,
  teacher_id    uuid not null references public.profiles (id) on delete cascade,
  class_id      uuid references public.classes (id) on delete set null,
  subject_id    uuid references public.subjects (id) on delete set null,
  class_name    text not null default '',
  subject_name  text not null default '',
  day_of_week   int not null check (day_of_week between 0 and 6), -- 0=Mon, 4=Fri
  period_number int not null default 1,
  start_time    time not null,
  end_time      time not null,
  room          text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists idx_schedule_slots_teacher on public.teacher_schedule_slots (teacher_id, day_of_week);

-- 5. Work Plans
create table if not exists public.work_plans (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools (id) on delete cascade,
  subject_id      uuid not null references public.subjects (id) on delete cascade,
  class_id        uuid not null references public.classes (id) on delete cascade,
  teacher_id      uuid not null references public.profiles (id) on delete cascade,
  scheme_id       uuid references public.curriculum_schemes (id) on delete set null,
  academic_year   text not null default '2026/2027',
  semester        text not null default '1',
  status          text not null default 'draft'
                  check (status in ('draft', 'submitted', 'under_review', 'approved', 'returned', 'archived')),
  revision        int not null default 1,
  resources       text not null default '',
  notes           text not null default '',
  submitted_at    timestamptz,
  approved_at     timestamptz,
  reviewer_id     uuid references public.profiles (id) on delete set null,
  review_comment  text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (school_id, subject_id, class_id, semester, academic_year)
);

create index if not exists idx_work_plans_teacher on public.work_plans (teacher_id);
create index if not exists idx_work_plans_class on public.work_plans (class_id);

-- 6. Work Plan Weeks
create table if not exists public.work_plan_weeks (
  id                uuid primary key default gen_random_uuid(),
  work_plan_id      uuid not null references public.work_plans (id) on delete cascade,
  sequence          int not null,
  week_label        text not null default '',
  month_label       text not null default '',
  start_date        date,
  end_date          date,
  is_instructional  boolean not null default true,
  event_label       text not null default '',
  topic_id          uuid references public.curriculum_topics (id) on delete set null,
  topic_title       text not null default '',
  challenge_title   text not null default '',
  subtopic_title    text not null default '',
  lessons_per_week  int not null default 1,
  remarks           text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (work_plan_id, sequence)
);

create index if not exists idx_work_plan_weeks_plan on public.work_plan_weeks (work_plan_id, sequence);

-- 7. Work Plan Week Objectives
create table if not exists public.work_plan_week_objectives (
  id                uuid primary key default gen_random_uuid(),
  work_plan_week_id uuid not null references public.work_plan_weeks (id) on delete cascade,
  objective_id      uuid references public.curriculum_objectives (id) on delete set null,
  code_snapshot     text not null default '',
  text_snapshot     text not null default '',
  is_met            boolean not null default false,
  met_at            timestamptz,
  created_at        timestamptz not null default now(),
  unique (work_plan_week_id, code_snapshot)
);

create index if not exists idx_work_plan_week_objs on public.work_plan_week_objectives (work_plan_week_id);

-- 8. Lesson Plans
create table if not exists public.lesson_plans (
  id                       uuid primary key default gen_random_uuid(),
  school_id                uuid not null references public.schools (id) on delete cascade,
  teacher_id               uuid not null references public.profiles (id) on delete cascade,
  subject_id               uuid not null references public.subjects (id) on delete cascade,
  class_id                 uuid not null references public.classes (id) on delete cascade,
  work_plan_week_id        uuid references public.work_plan_weeks (id) on delete set null,
  schedule_slot_id         uuid references public.teacher_schedule_slots (id) on delete set null,
  lesson_date              date not null default current_date,
  start_time               time,
  end_time                 time,
  topic_title              text not null default '',
  challenge_title          text not null default '',
  subtopic_title           text not null default '',
  main_teaching_activity   text not null default '',
  assessment_ideas         text not null default '',
  resources                text not null default '',
  differentiation          text not null default '',
  boys_attendance          int,
  girls_attendance         int,
  reflection_remarks       text not null default '',
  status                   text not null default 'draft'
                           check (status in ('draft', 'submitted', 'approved', 'returned')),
  revision                 int not null default 1,
  submitted_at             timestamptz,
  approved_at              timestamptz,
  reviewer_id              uuid references public.profiles (id) on delete set null,
  review_comment           text not null default '',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_lesson_plans_teacher on public.lesson_plans (teacher_id, lesson_date);
create index if not exists idx_lesson_plans_class on public.lesson_plans (class_id);

-- 9. Lesson Plan Objectives
create table if not exists public.lesson_plan_objectives (
  id              uuid primary key default gen_random_uuid(),
  lesson_plan_id  uuid not null references public.lesson_plans (id) on delete cascade,
  objective_id    uuid references public.curriculum_objectives (id) on delete set null,
  code_snapshot   text not null default '',
  text_snapshot   text not null default '',
  created_at      timestamptz not null default now(),
  unique (lesson_plan_id, code_snapshot)
);

create index if not exists idx_lesson_plan_objs on public.lesson_plan_objectives (lesson_plan_id);

-- 10. Audit / Workflow Events
create table if not exists public.work_plan_events (
  id            uuid primary key default gen_random_uuid(),
  work_plan_id  uuid not null references public.work_plans (id) on delete cascade,
  actor_id      uuid not null references public.profiles (id) on delete cascade,
  from_status   text not null default '',
  to_status     text not null default '',
  comment       text not null default '',
  created_at    timestamptz not null default now()
);

create table if not exists public.lesson_plan_events (
  id              uuid primary key default gen_random_uuid(),
  lesson_plan_id  uuid not null references public.lesson_plans (id) on delete cascade,
  actor_id        uuid not null references public.profiles (id) on delete cascade,
  from_status     text not null default '',
  to_status       text not null default '',
  comment         text not null default '',
  created_at      timestamptz not null default now()
);

-- ==============================================================================
-- RLS POLICIES
-- ==============================================================================

alter table public.curriculum_schemes enable row level security;
alter table public.curriculum_topics enable row level security;
alter table public.curriculum_objectives enable row level security;
alter table public.teacher_timetables enable row level security;
alter table public.teacher_schedule_slots enable row level security;
alter table public.work_plans enable row level security;
alter table public.work_plan_weeks enable row level security;
alter table public.work_plan_week_objectives enable row level security;
alter table public.lesson_plans enable row level security;
alter table public.lesson_plan_objectives enable row level security;
alter table public.work_plan_events enable row level security;
alter table public.lesson_plan_events enable row level security;

-- Read policies: curriculum is readable by all signed-in users
create policy "curriculum_schemes_read" on public.curriculum_schemes for select using (auth.uid() is not null);
create policy "curriculum_topics_read" on public.curriculum_topics for select using (auth.uid() is not null);
create policy "curriculum_objectives_read" on public.curriculum_objectives for select using (auth.uid() is not null);

-- Write policies: HOS, Coordinator, and Admin can manage curriculum
create policy "curriculum_schemes_write" on public.curriculum_schemes for all
  using (public.has_role('head_of_school') or public.has_role('curriculum_coordinator') or public.has_role('admin'));
create policy "curriculum_topics_write" on public.curriculum_topics for all
  using (public.has_role('head_of_school') or public.has_role('curriculum_coordinator') or public.has_role('admin'));
create policy "curriculum_objectives_write" on public.curriculum_objectives for all
  using (public.has_role('head_of_school') or public.has_role('curriculum_coordinator') or public.has_role('admin'));

-- Timetable & slots: teachers manage their own; leadership can view all
create policy "timetables_all" on public.teacher_timetables for all
  using (teacher_id = auth.uid() or public.has_role('head_of_school') or public.has_role('curriculum_coordinator') or public.has_role('director'));
create policy "schedule_slots_all" on public.teacher_schedule_slots for all
  using (teacher_id = auth.uid() or public.has_role('head_of_school') or public.has_role('curriculum_coordinator') or public.has_role('director'));

-- Work Plans: teachers read/write their own; leadership reads and can review/approve
create policy "work_plans_select" on public.work_plans for select
  using (teacher_id = auth.uid() or public.has_role('head_of_school') or public.has_role('curriculum_coordinator') or public.has_role('director'));
create policy "work_plans_insert" on public.work_plans for insert
  with check (teacher_id = auth.uid() or public.has_role('head_of_school') or public.has_role('curriculum_coordinator'));
create policy "work_plans_update" on public.work_plans for update
  using (teacher_id = auth.uid() or public.has_role('head_of_school') or public.has_role('curriculum_coordinator'));
create policy "work_plans_delete" on public.work_plans for delete
  using (teacher_id = auth.uid() or public.has_role('head_of_school'));

-- Work Plan Weeks & Objectives
create policy "work_plan_weeks_all" on public.work_plan_weeks for all using (true);
create policy "work_plan_week_objectives_all" on public.work_plan_week_objectives for all using (true);

-- Lesson Plans: teachers read/write their own; leadership reads and can review/approve
create policy "lesson_plans_select" on public.lesson_plans for select
  using (teacher_id = auth.uid() or public.has_role('head_of_school') or public.has_role('curriculum_coordinator') or public.has_role('director'));
create policy "lesson_plans_insert" on public.lesson_plans for insert
  with check (teacher_id = auth.uid() or public.has_role('head_of_school') or public.has_role('curriculum_coordinator'));
create policy "lesson_plans_update" on public.lesson_plans for update
  using (teacher_id = auth.uid() or public.has_role('head_of_school') or public.has_role('curriculum_coordinator'));
create policy "lesson_plans_delete" on public.lesson_plans for delete
  using (teacher_id = auth.uid() or public.has_role('head_of_school'));

create policy "lesson_plan_objectives_all" on public.lesson_plan_objectives for all using (true);
create policy "work_plan_events_all" on public.work_plan_events for all using (true);
create policy "lesson_plan_events_all" on public.lesson_plan_events for all using (true);
