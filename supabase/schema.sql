-- The Last Bin database schema
-- Applied to Supabase as migration: add_private_student_transactions

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

alter table public.profiles
  add column if not exists department text;

update public.profiles
set department = 'Not specified'
where department is null or trim(department) = '';

alter table public.profiles
  alter column department set not null;

alter table public.profiles
  drop constraint if exists profiles_department_check;

alter table public.profiles
  add constraint profiles_department_check
  check (char_length(trim(department)) between 2 and 120);

alter table public.profiles
  drop constraint if exists profiles_student_id_check;

alter table public.profiles
  drop constraint if exists profiles_student_id_length;

alter table public.profiles
  alter column student_id set not null;

alter table public.profiles
  add constraint profiles_student_id_check
  check (char_length(student_id) between 3 and 80);

create unique index if not exists profiles_student_id_key
  on public.profiles (student_id);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, student_id, department)
  values (
    new.id,
    null,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(trim(new.raw_user_meta_data ->> 'student_id'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'department'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function private.touch_profile_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_profile_updated_at on public.profiles;
create trigger touch_profile_updated_at
before update on public.profiles
for each row execute function private.touch_profile_updated_at();

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null default gen_random_uuid() unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('bottle', 'pen', 'book')),
  item_label text not null check (char_length(item_label) between 1 and 120),
  weight_g integer not null check (weight_g > 0 and weight_g <= 5000),
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  points integer not null default 0 check (points >= 0),
  status text not null default 'confirmed' check (status in ('confirmed', 'pending', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_created_idx
  on public.transactions (user_id, created_at desc);

create or replace function private.set_transaction_server_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  if new.user_id is null then
    raise exception 'Authentication required';
  end if;

  new.points := case new.item_type
    when 'pen' then 2
    when 'bottle' then greatest(1, round(new.weight_g::numeric / 50)::integer)
    when 'book' then greatest(1, round(new.weight_g::numeric / 100)::integer)
    else 0
  end;
  new.status := 'confirmed';
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists set_transaction_server_fields on public.transactions;
create trigger set_transaction_server_fields
before insert on public.transactions
for each row execute function private.set_transaction_server_fields();

alter table public.transactions enable row level security;

drop policy if exists "Students can read their own transactions" on public.transactions;
create policy "Students can read their own transactions"
on public.transactions for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Students can create their own transactions" on public.transactions;
create policy "Students can create their own transactions"
on public.transactions for insert
to authenticated
with check ((select auth.uid()) = user_id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (email, full_name) on public.profiles to authenticated;

revoke all on public.transactions from anon, authenticated;
grant select on public.transactions to authenticated;
grant insert (deposit_id, item_type, item_label, weight_g, confidence)
  on public.transactions to authenticated;
