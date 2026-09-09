-- Keep self-registered users pending, but attach them to the current school
-- so the Head of School can find and assign them.

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

-- Repair accounts created by the old trigger in a single-school deployment.
update public.profiles
set school_id = (select id from public.schools order by created_at limit 1)
where role = 'pending'
  and school_id is null
  and (select count(*) from public.schools) = 1;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
using (
  id = auth.uid()
  or public.my_role() = 'head_of_school'
);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (
  id = auth.uid()
  or public.my_role() = 'head_of_school'
) with check (
  id = auth.uid()
  or public.my_role() = 'head_of_school'
);