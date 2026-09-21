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
  points numeric(10,3) not null default 0 check (points >= 0),
  status text not null default 'confirmed' check (status in ('confirmed', 'pending', 'rejected')),
  created_at timestamptz not null default now()
);

-- Preserve existing rewards while allowing exact proportional points for future deposits.
alter table public.transactions
  alter column points type numeric(10,3)
  using points::numeric(10,3);

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

  new.points := round(
    (new.weight_g::numeric / 1000) *
    case new.item_type
      when 'book' then 20
      when 'bottle' then 10
      when 'pen' then 9
      else 0
    end,
    3
  );
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

create table if not exists public.redemptions (
  id uuid primary key default gen_random_uuid(),
  redeem_id uuid not null default gen_random_uuid() unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_item text not null check (reward_item in ('a4_notebook', 'pen', 'pencil', 'pocket_diary', 'sketch_pens', 'transparent_folder')),
  item_label text not null check (char_length(item_label) between 1 and 120),
  points_cost numeric(10,3) not null check (points_cost > 0),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists redemptions_user_created_idx
  on public.redemptions (user_id, created_at desc);

create or replace function private.set_redemption_server_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  earned_points numeric := 0;
  spent_points numeric := 0;
begin
  new.user_id := auth.uid();
  if new.user_id is null then
    raise exception 'Authentication required';
  end if;

  -- Serialize redemption attempts for one student to prevent double-spending.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 0)
  );

  case new.reward_item
    when 'a4_notebook' then new.item_label := 'A4-size notebook'; new.points_cost := 40;
    when 'pen' then new.item_label := 'Pen'; new.points_cost := 5;
    when 'pencil' then new.item_label := 'Pencil'; new.points_cost := 4;
    when 'pocket_diary' then new.item_label := 'Pocket-size diary'; new.points_cost := 15;
    when 'sketch_pens' then new.item_label := 'Sketch pens'; new.points_cost := 25;
    when 'transparent_folder' then new.item_label := 'Transparent folder'; new.points_cost := 15;
    else raise exception 'Unknown reward item';
  end case;

  select coalesce(sum(points), 0)
  into earned_points
  from public.transactions
  where user_id = new.user_id and status = 'confirmed';

  select coalesce(sum(points_cost), 0)
  into spent_points
  from public.redemptions
  where user_id = new.user_id and status = 'confirmed';

  if earned_points - spent_points < new.points_cost then
    raise exception 'Insufficient points';
  end if;

  new.status := 'confirmed';
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists set_redemption_server_fields on public.redemptions;
create trigger set_redemption_server_fields
before insert on public.redemptions
for each row execute function private.set_redemption_server_fields();

alter table public.redemptions enable row level security;

drop policy if exists "Students can read their own redemptions" on public.redemptions;
create policy "Students can read their own redemptions"
on public.redemptions for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Students can redeem from their own balance" on public.redemptions;
create policy "Students can redeem from their own balance"
on public.redemptions for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

revoke all on public.redemptions from anon, authenticated;
grant select on public.redemptions to authenticated;
grant insert (redeem_id, reward_item) on public.redemptions to authenticated;

create or replace function public.get_my_points_balance()
returns numeric(10,3)
language sql
stable
security invoker
set search_path = ''
as $$
  select greatest(
    coalesce((
      select sum(t.points)
      from public.transactions t
      where t.user_id = (select auth.uid()) and t.status = 'confirmed'
    ), 0::numeric) - coalesce((
      select sum(r.points_cost)
      from public.redemptions r
      where r.user_id = (select auth.uid()) and r.status = 'confirmed'
    ), 0::numeric),
    0::numeric
  )::numeric(10,3);
$$;

revoke all on function public.get_my_points_balance() from public, anon;
grant execute on function public.get_my_points_balance() to authenticated;
