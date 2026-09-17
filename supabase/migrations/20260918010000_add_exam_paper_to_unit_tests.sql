-- ==============================================================================
-- Migration: Add Exam Paper Columns & Storage Bucket for Unit Tests
-- ==============================================================================

-- 1. Add exam paper columns to unit_tests
alter table public.unit_tests add column if not exists exam_paper_url text;
alter table public.unit_tests add column if not exists exam_paper_path text;
alter table public.unit_tests add column if not exists exam_paper_name text;

-- 2. Create storage bucket for exam papers
insert into storage.buckets (id, name, public)
values ('exam-papers', 'exam-papers', true)
on conflict (id) do update set public = true;

-- 3. Storage policies for exam-papers bucket
drop policy if exists "Allow authenticated to upload exam papers" on storage.objects;
create policy "Allow authenticated to upload exam papers" on storage.objects for insert to authenticated
with check (bucket_id = 'exam-papers');

drop policy if exists "Allow school members to read exam papers" on storage.objects;
create policy "Allow school members to read exam papers" on storage.objects for select to authenticated
using (bucket_id = 'exam-papers');

drop policy if exists "Allow teachers to update own exam papers" on storage.objects;
create policy "Allow teachers to update own exam papers" on storage.objects for update to authenticated
using (bucket_id = 'exam-papers');

drop policy if exists "Allow teachers to delete own exam papers" on storage.objects;
create policy "Allow teachers to delete own exam papers" on storage.objects for delete to authenticated
using (bucket_id = 'exam-papers');
