-- Bloom Studio Supabase schema
-- Run in Supabase Dashboard -> SQL Editor. This schema enables RLS on all app tables.
-- Do not put the Supabase service_role key in browser code.

create extension if not exists pgcrypto;

create type public.member_role as enum ('member', 'admin');
create type public.booking_status as enum ('booked', 'cancelled', 'attended');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Bloom member' check (char_length(full_name) <= 80),
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  category text not null check (category in ('yoga','dance','strength','mindful','cardio')),
  trainer_name text not null check (char_length(trainer_name) between 1 and 80),
  duration_minutes integer not null check (duration_minutes between 10 and 240),
  capacity integer not null default 12 check (capacity between 1 and 100),
  description text not null default '' check (char_length(description) <= 180),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete restrict,
  starts_at timestamptz not null,
  status public.booking_status not null default 'booked',
  created_at timestamptz not null default now(),
  constraint bookings_future_start check (starts_at > created_at),
  constraint bookings_unique_active unique (user_id, class_id, starts_at)
);

create index bookings_user_starts_idx on public.bookings(user_id, starts_at);
create index bookings_class_starts_idx on public.bookings(class_id, starts_at);

-- Create a profile automatically for every new Auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Bloom member')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Generic updated_at trigger.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();

-- Booking RPC enforces identity, class status, future time, capacity, and no duplicates.
-- The advisory lock serializes capacity checks for a given class and start time.
create or replace function public.book_class(p_class_id uuid, p_starts_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_capacity integer;
  v_active_count integer;
  v_booking_id uuid;
begin
  if v_user_id is null then
    raise exception 'Please log in to book a class.';
  end if;
  if p_starts_at <= now() then
    raise exception 'Choose a future date and time.';
  end if;
  if p_starts_at > now() + interval '180 days' then
    raise exception 'Bookings can only be made up to 180 days ahead.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_class_id::text), hashtext(p_starts_at::text));

  select capacity into v_capacity
  from public.classes
  where id = p_class_id and is_active = true;
  if v_capacity is null then
    raise exception 'This class is unavailable.';
  end if;

  select count(*) into v_active_count
  from public.bookings
  where class_id = p_class_id and starts_at = p_starts_at and status = 'booked';
  if v_active_count >= v_capacity then
    raise exception 'Sorry, this class session is full.';
  end if;

  insert into public.bookings (user_id, class_id, starts_at)
  values (v_user_id, p_class_id, p_starts_at)
  returning id into v_booking_id;
  return v_booking_id;
exception
  when unique_violation then
    raise exception 'You already booked this class at that time.';
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Please log in first.'; end if;
  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id and user_id = v_user_id and status = 'booked';
  if not found then raise exception 'Booking not found or already cancelled.'; end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.bookings enable row level security;

-- Security-definer role helper prevents RLS recursion on profiles.
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- Profiles: members can view/update only their own name; never their role.
create policy "profiles_select_own_or_admin" on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_admin());

create policy "profiles_update_own_name" on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid() and role = 'member');

-- Public can read only active classes; admins can read all and manage them.
create policy "classes_read_active_or_admin" on public.classes
for select to anon, authenticated
using (is_active = true or public.is_admin());

create policy "classes_admin_insert" on public.classes
for insert to authenticated
with check (public.is_admin());

create policy "classes_admin_update" on public.classes
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "classes_admin_delete" on public.classes
for delete to authenticated
using (public.is_admin());

-- Members can only read their own bookings; admins can read all.
create policy "bookings_read_own_or_admin" on public.bookings
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

-- Booking writes are through SECURITY DEFINER RPCs only.
revoke insert, update, delete on public.bookings from anon, authenticated;
revoke all on function public.book_class(uuid, timestamptz) from public;
grant execute on function public.book_class(uuid, timestamptz) to authenticated;
revoke all on function public.cancel_booking(uuid) from public;
grant execute on function public.cancel_booking(uuid) to authenticated;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

grant select on public.classes to anon, authenticated;
grant insert, update, delete on public.classes to authenticated;
grant select on public.bookings to authenticated;
grant select, update on public.profiles to authenticated;

-- Seed starter classes. Safe to run again; names are not unique so use a simple empty-table guard.
insert into public.classes (name, category, trainer_name, duration_minutes, capacity, description)
select seed.name, seed.category, seed.trainer_name, seed.duration_minutes, seed.capacity, seed.description
from (values
  ('Morning Flow Yoga', 'yoga', 'Ayesha Malik', 45, 14, 'Find your calm, one pose at a time.'),
  ('Zumba Party', 'dance', 'Fatima Khan', 50, 18, 'Big beats, joyful moves, good vibes.'),
  ('Full Body Strength', 'strength', 'Noor Zahra', 40, 12, 'Build confidence, one rep at a time.'),
  ('Mat Pilates', 'mindful', 'Sana Ali', 35, 12, 'Core strength with mindful movement.'),
  ('Cardio Dance', 'cardio', 'Mariam Shah', 35, 16, 'Fun-paced movement to lift your energy.'),
  ('Stretch & Recovery', 'mindful', 'Ayesha Malik', 25, 14, 'A gentle reset for body and mind.'),
  ('Core & Sculpt', 'strength', 'Noor Zahra', 40, 12, 'Build strength with focused movement.')
) as seed(name, category, trainer_name, duration_minutes, capacity, description)
where not exists (select 1 from public.classes);

-- IMPORTANT: after creating your own account, promote that user to admin manually in SQL Editor:
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'YOUR_EMAIL');
-- Do not expose admin role editing to the public browser client.
