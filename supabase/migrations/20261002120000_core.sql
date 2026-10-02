-- Core identity, students, consent and admin tables (BUILD_PLAN Phase 1).
-- All timestamps are timestamptz, stored as UTC. All writes go through server code using the
-- service role; signed-in users only ever read, and only through the RLS policies below.

create type public.app_role as enum ('payer', 'group_buyer', 'reviewer', 'ambassador', 'admin');
create type public.payer_region as enum ('abroad', 'nigeria');
create type public.currency as enum ('GBP', 'USD', 'CAD', 'NGN');
create type public.student_class as enum ('JSS1', 'JSS2', 'SS1', 'SS2', 'SS3', 'UTME');
create type public.exam as enum ('BECE', 'WASSCE', 'NECO', 'UTME');
-- Must match SUBJECTS in src/config/pilot.ts (checked by test/db/schema.test.ts).
create type public.subject as enum ('english', 'mathematics', 'physics', 'biology');
create type public.group_kind as enum ('church', 'alumni', 'school', 'other');
create type public.consent_method as enum ('web_checkbox', 'group_attestation', 'admin_recorded');
create type public.consent_event as enum ('granted', 'withdrawn');
create type public.data_request_kind as enum ('export', 'delete');
create type public.data_request_status as enum ('pending', 'completed', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'payer',
  created_at timestamptz not null default now()
);

create table public.payers (
  id uuid primary key references public.profiles (id) on delete cascade,
  region public.payer_region not null,
  currency public.currency not null,
  -- IANA zone such as Europe/London; validated in the app. Weekly reports use it.
  timezone text not null,
  whatsapp_number text check (whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now(),
  constraint payer_currency_matches_region check ((region = 'nigeria') = (currency = 'NGN'))
);

create table public.group_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id),
  name text not null check (char_length(name) between 2 and 120),
  kind public.group_kind not null,
  created_at timestamptz not null default now()
);

-- Minimal data only (CLAUDE.md): first name, last initial, class, birth year, exam, subjects and,
-- for seniors only, a WhatsApp number.
create table public.students (
  id uuid primary key default gen_random_uuid(),
  -- The parent, sponsor or group buyer account that manages this student.
  owner_id uuid not null references public.profiles (id),
  first_name text not null check (char_length(btrim(first_name)) between 1 and 40),
  last_initial text not null check (last_initial ~ '^[A-Z]$'),
  class public.student_class not null,
  birth_year smallint not null check (birth_year between 1990 and 2030),
  exam public.exam not null,
  subjects public.subject[] not null check (cardinality(subjects) between 1 and 4),
  whatsapp_number text unique check (whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now()
);

create index students_owner_id_idx on public.students (owner_id);

-- With only a birth year we cannot know the exact age, so a student counts as 13 or over only if
-- they are 13 even with the latest possible birthday: current Lagos year - birth year >= 14.
-- BUILD_PLAN decision 1 (recommended rule, pending confirmation).
create function public.is_senior_birth_year(p_birth_year integer, p_at timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(year from (p_at at time zone 'Africa/Lagos'))::integer - p_birth_year >= 14
$$;

create function public.students_guard_whatsapp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.whatsapp_number is not null and not public.is_senior_birth_year(new.birth_year) then
    raise exception 'students under 13 cannot have a WhatsApp number'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger students_guard_whatsapp
before insert or update of whatsapp_number, birth_year on public.students
for each row execute function public.students_guard_whatsapp();

-- Append-only consent history. The latest event per student is the current state.
create table public.guardian_consents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  event public.consent_event not null,
  method public.consent_method not null,
  consent_text_version text not null,
  given_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index guardian_consents_student_idx on public.guardian_consents (student_id, created_at desc);

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- Every admin change is written here (CLAUDE.md). Store ids, never student personal data.
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key: the request record must outlive a deleted student.
  student_id uuid not null,
  kind public.data_request_kind not null,
  status public.data_request_status not null default 'pending',
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.ambassadors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  name text not null check (char_length(name) between 2 and 80),
  code text not null unique check (code ~ '^[A-Z0-9]{4,16}$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Rows in these tables are never edited (consent) or never edited or removed (audit log).
create function public.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

create trigger guardian_consents_append_only
before update on public.guardian_consents
for each row execute function public.forbid_change();

create trigger audit_log_append_only
before update or delete on public.audit_log
for each row execute function public.forbid_change();

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'
  )
$$;

-- Row Level Security: enabled everywhere; read-only policies for signed-in users.
alter table public.profiles enable row level security;
alter table public.payers enable row level security;
alter table public.group_accounts enable row level security;
alter table public.students enable row level security;
alter table public.guardian_consents enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;
alter table public.data_requests enable row level security;
alter table public.ambassadors enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy payers_read on public.payers for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy group_accounts_read on public.group_accounts for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));

create policy students_read on public.students for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));

create policy guardian_consents_read on public.guardian_consents for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.students s where s.id = student_id and s.owner_id = (select auth.uid()))
  );

create policy settings_read on public.settings for select to authenticated
  using ((select public.is_admin()));

create policy audit_log_read on public.audit_log for select to authenticated
  using ((select public.is_admin()));

create policy data_requests_read on public.data_requests for select to authenticated
  using (requested_by = (select auth.uid()) or (select public.is_admin()));

create policy ambassadors_read on public.ambassadors for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));
