-- KinPrep database schema, generated from supabase/migrations by `npm run db:schema`.
-- Do not edit: change a migration (or add one) and regenerate.
--
-- Only for a NEW, EMPTY Supabase project: paste all of it into SQL Editor > New query > Run.
-- On a project that already has the tables, use `npm run db:push` instead.

-- ===== 20261002120000_core.sql =====
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

-- ===== 20261002120100_billing.sql =====
-- Billing: subscriptions, bulk seats, sponsor links, webhook events and the payments ledger.
-- Provider code (src/lib/payments) turns each verified webhook into a provider-neutral update and
-- calls apply_billing_event, which records the event id (idempotency), updates the subscription
-- and writes the ledger in one transaction. Access is decided only by isStudentActive
-- (src/lib/payments/access.ts) from student_coverages below.

-- 'trial' is KinPrep's own no-card free trial (naira payers; Stripe trials live in Stripe).
create type public.payment_provider as enum ('stripe', 'paystack', 'manual', 'trial');
create type public.subscription_status as enum ('incomplete', 'trialing', 'active', 'past_due', 'canceled');
create type public.payment_status as enum ('succeeded', 'failed', 'refunded');

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  provider public.payment_provider not null,
  -- Null for pay-per-period coverage (Paystack transfer/USSD, Manual), which has one rolling row
  -- per student or group. "pending:<reference>" until Paystack confirms the subscription code.
  provider_subscription_id text,
  provider_customer_id text,
  student_id uuid references public.students (id) on delete cascade,
  group_account_id uuid references public.group_accounts (id) on delete cascade,
  seats integer check (seats > 0),
  -- A PlanId from src/config/pricing.ts; validated in the app.
  plan text not null,
  currency public.currency not null,
  status public.subscription_status not null,
  current_period_end timestamptz,
  trial_end timestamptz,
  grace_until timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  payer_id uuid references public.payers (id) on delete set null,
  payer_email text,
  ambassador_id uuid references public.ambassadors (id) on delete set null,
  referral_code text,
  -- Provider data needed to manage the subscription later, such as Paystack's email_token.
  provider_meta jsonb not null default '{}',
  -- Provider time of the last state change applied; older events never overwrite newer state.
  state_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint covers_student_or_group check (num_nonnulls(student_id, group_account_id) = 1),
  constraint seats_only_for_groups check ((group_account_id is null) = (seats is null)),
  constraint provider_subscription_unique unique (provider, provider_subscription_id)
);

create index subscriptions_student_idx on public.subscriptions (student_id);
create index subscriptions_customer_idx on public.subscriptions (provider, provider_customer_id);
create unique index subscriptions_rolling_student_uq on public.subscriptions (provider, student_id)
  where provider_subscription_id is null and student_id is not null;
create unique index subscriptions_rolling_group_uq on public.subscriptions (provider, group_account_id)
  where provider_subscription_id is null and group_account_id is not null;

create table public.seat_assignments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  constraint released_after_assigned check (released_at is null or released_at >= assigned_at)
);

create unique index seat_assignments_open_uq on public.seat_assignments (subscription_id, student_id)
  where released_at is null;
create index seat_assignments_student_idx on public.seat_assignments (student_id);

create function public.seat_assignments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_seats integer;
  v_used integer;
begin
  -- Lock the subscription so concurrent assignments cannot both take the last seat.
  select seats into v_seats from public.subscriptions where id = new.subscription_id for update;
  if v_seats is null then
    raise exception 'seats can only be assigned on a group subscription' using errcode = 'check_violation';
  end if;
  if new.released_at is null then
    select count(*) into v_used from public.seat_assignments
    where subscription_id = new.subscription_id and released_at is null and id <> new.id;
    if v_used >= v_seats then
      raise exception 'all % seats are in use', v_seats using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger seat_assignments_guard
before insert or update of subscription_id, released_at on public.seat_assignments
for each row execute function public.seat_assignments_guard();

-- "Get sponsored" links: /sponsor/<code>. The code is 128 random bits, base64url encoded.
create table public.sponsor_links (
  code text primary key check (code ~ '^[A-Za-z0-9_-]{22,64}$'),
  student_id uuid not null references public.students (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index sponsor_links_active_uq on public.sponsor_links (student_id) where revoked_at is null;

-- Every verified webhook (and manual entry), keyed by provider event id for idempotency.
create table public.billing_events (
  provider public.payment_provider not null,
  event_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  payload jsonb not null,
  primary key (provider, event_id)
);

-- The payments ledger: money in (and failed attempts). Rows outlive deleted students.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  provider public.payment_provider not null,
  provider_payment_id text not null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  status public.payment_status not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency public.currency not null,
  occurred_at timestamptz not null,
  period_start timestamptz,
  period_end timestamptz,
  -- card, bank_transfer, ussd, manual_transfer ...
  channel text,
  ambassador_id uuid references public.ambassadors (id) on delete set null,
  recorded_by uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint payments_provider_payment_unique unique (provider, provider_payment_id)
);

create index payments_subscription_idx on public.payments (subscription_id);

-- Applies one provider-neutral billing update atomically. Returns {"result": "applied"|"duplicate"}.
-- Shape (all keys optional unless stated):
-- {
--   provider*, event_id*, event_type*, occurred_at*, payload,
--   subscription: {
--     id | provider_subscription_id | match_customer: {customer_id, plan, pending_only},
--     student_id, group_account_id, seats, plan, currency, provider_customer_id, payer_email,
--     payer_id, ambassador_id, referral_code, provider_meta,
--     status, current_period_end, trial_end, grace_until, cancel_at_period_end, canceled_at,
--     extend: {from*, by: '7 days' | '1 month' | ..., until}   -- pay-per-period coverage
--   },
--   payment: {provider_payment_id*, status*, amount_minor*, currency*, occurred_at,
--             period_start, period_end, channel, recorded_by, note},
--   audit: {actor_id, action, details}
-- }
-- State keys are applied only if present, and only if the event is not older than the last state
-- applied. A repeated payment failure never pushes grace_until later.
create function public.apply_billing_event(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_provider public.payment_provider := (p ->> 'provider')::public.payment_provider;
  v_event_id text := p ->> 'event_id';
  v_occurred timestamptz := (p ->> 'occurred_at')::timestamptz;
  s jsonb := nullif(p -> 'subscription', 'null'::jsonb);
  pay jsonb := nullif(p -> 'payment', 'null'::jsonb);
  v_extend jsonb;
  v_sub public.subscriptions;
  v_apply_state boolean;
  v_payment_is_new boolean := true;
  v_from timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  if v_event_id is null or v_occurred is null or p ->> 'event_type' is null then
    raise exception 'billing event needs event_id, event_type and occurred_at'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.billing_events (provider, event_id, event_type, occurred_at, payload)
  values (v_provider, v_event_id, p ->> 'event_type', v_occurred, coalesce(p -> 'payload', '{}'::jsonb))
  on conflict (provider, event_id) do nothing;
  if not found then
    return jsonb_build_object('result', 'duplicate');
  end if;

  if s is not null then
    -- 1. Find the subscription this event is about.
    if s ->> 'id' is not null then
      select * into v_sub from public.subscriptions
      where provider = v_provider and id = (s ->> 'id')::uuid
      for update;
    elsif s ->> 'provider_subscription_id' is not null then
      select * into v_sub from public.subscriptions
      where provider = v_provider and provider_subscription_id = s ->> 'provider_subscription_id'
      for update;
    end if;

    if v_sub.id is null and s ? 'match_customer' then
      select * into v_sub from public.subscriptions
      where provider = v_provider
        and provider_customer_id = s -> 'match_customer' ->> 'customer_id'
        and plan = s -> 'match_customer' ->> 'plan'
        and (
          not coalesce((s -> 'match_customer' ->> 'pending_only')::boolean, false)
          or provider_subscription_id like 'pending:%'
        )
      order by current_period_end asc nulls first, created_at asc
      limit 1
      for update;
    end if;

    if v_sub.id is null and s ->> 'id' is null and s ->> 'provider_subscription_id' is null
      and not (s ? 'match_customer') then
      if s ->> 'student_id' is not null then
        select * into v_sub from public.subscriptions
        where provider = v_provider and provider_subscription_id is null
          and student_id = (s ->> 'student_id')::uuid
        for update;
      elsif s ->> 'group_account_id' is not null then
        select * into v_sub from public.subscriptions
        where provider = v_provider and provider_subscription_id is null
          and group_account_id = (s ->> 'group_account_id')::uuid
        for update;
      end if;
    end if;

    -- 2. First event for this subscription: create it.
    if v_sub.id is null
      and s ->> 'student_id' is not null
      and not exists (select 1 from public.students where id = (s ->> 'student_id')::uuid)
    then
      -- The student's data was deleted (their subscriptions were cancelled first). Keep the event
      -- for the record and the payment in the ledger, but recreate nothing.
      if pay is not null then
        insert into public.payments (
          provider, provider_payment_id, status, amount_minor, currency, occurred_at, channel
        )
        values (
          v_provider, pay ->> 'provider_payment_id', (pay ->> 'status')::public.payment_status,
          (pay ->> 'amount_minor')::bigint, (pay ->> 'currency')::public.currency,
          coalesce((pay ->> 'occurred_at')::timestamptz, v_occurred), pay ->> 'channel'
        )
        on conflict (provider, provider_payment_id) do nothing;
      end if;
      update public.billing_events set processed_at = now()
      where provider = v_provider and event_id = v_event_id;
      return jsonb_build_object('result', 'applied', 'note', 'student deleted');
    end if;

    if v_sub.id is null then
      if s ->> 'id' is not null or (s ->> 'student_id' is null and s ->> 'group_account_id' is null) then
        -- Usually an event that arrived before the one that creates the subscription. Raising
        -- rolls back the event record, so the provider's retry is processed normally.
        raise exception 'billing event % refers to an unknown subscription', v_event_id
          using errcode = 'no_data_found';
      end if;
      insert into public.subscriptions (
        provider, provider_subscription_id, student_id, group_account_id, seats, plan, currency, status
      )
      values (
        v_provider,
        s ->> 'provider_subscription_id',
        (s ->> 'student_id')::uuid,
        (s ->> 'group_account_id')::uuid,
        (s ->> 'seats')::integer,
        s ->> 'plan',
        (s ->> 'currency')::public.currency,
        'incomplete'
      )
      returning * into v_sub;
    end if;

    -- 3. Apply identity fields always, state fields only if this event is not stale.
    v_apply_state := v_sub.state_at is null or v_occurred >= v_sub.state_at;

    update public.subscriptions t set
      provider_subscription_id = coalesce(s ->> 'provider_subscription_id', t.provider_subscription_id),
      provider_customer_id = coalesce(s ->> 'provider_customer_id', t.provider_customer_id),
      payer_email = coalesce(s ->> 'payer_email', t.payer_email),
      payer_id = coalesce((s ->> 'payer_id')::uuid, t.payer_id),
      -- The first referral attached sticks.
      ambassador_id = coalesce(t.ambassador_id, (s ->> 'ambassador_id')::uuid),
      referral_code = coalesce(t.referral_code, s ->> 'referral_code'),
      provider_meta = t.provider_meta || coalesce(s -> 'provider_meta', '{}'::jsonb),
      plan = case when v_apply_state then coalesce(s ->> 'plan', t.plan) else t.plan end,
      seats = case when v_apply_state then coalesce((s ->> 'seats')::integer, t.seats) else t.seats end,
      status = case when v_apply_state and s ? 'status'
        then (s ->> 'status')::public.subscription_status else t.status end,
      current_period_end = case when v_apply_state and s ? 'current_period_end'
        then (s ->> 'current_period_end')::timestamptz else t.current_period_end end,
      trial_end = case when v_apply_state and s ? 'trial_end'
        then (s ->> 'trial_end')::timestamptz else t.trial_end end,
      cancel_at_period_end = case when v_apply_state and s ? 'cancel_at_period_end'
        then (s ->> 'cancel_at_period_end')::boolean else t.cancel_at_period_end end,
      canceled_at = case when v_apply_state and s ? 'canceled_at'
        then (s ->> 'canceled_at')::timestamptz else t.canceled_at end,
      grace_until = case
        when not (v_apply_state and s ? 'grace_until') then t.grace_until
        when t.status = 'past_due' and t.grace_until is not null and s ->> 'status' = 'past_due'
          then t.grace_until
        else (s ->> 'grace_until')::timestamptz
      end,
      state_at = case when v_apply_state then v_occurred else t.state_at end,
      updated_at = now()
    where t.id = v_sub.id
    returning t.* into v_sub;

    -- 4. Pay-per-period coverage: extend once per payment.
    v_extend := nullif(s -> 'extend', 'null'::jsonb);
    if v_extend is not null then
      if pay is not null then
        perform 1 from public.payments
        where provider = v_provider and provider_payment_id = pay ->> 'provider_payment_id';
        v_payment_is_new := not found;
      end if;
      if v_payment_is_new then
        v_from := (v_extend ->> 'from')::timestamptz;
        if v_extend ->> 'until' is not null then
          v_period_start := v_from;
          v_period_end := (v_extend ->> 'until')::timestamptz;
        else
          v_period_start := greatest(coalesce(v_sub.current_period_end, v_from), v_from);
          v_period_end := v_period_start + (v_extend ->> 'by')::interval;
        end if;
        update public.subscriptions set
          current_period_end = greatest(coalesce(current_period_end, v_period_end), v_period_end),
          status = 'active',
          grace_until = null,
          canceled_at = null,
          state_at = greatest(state_at, v_occurred),
          updated_at = now()
        where id = v_sub.id
        returning * into v_sub;
      end if;
    end if;
  end if;

  if pay is not null then
    insert into public.payments (
      provider, provider_payment_id, subscription_id, status, amount_minor, currency, occurred_at,
      period_start, period_end, channel, ambassador_id, recorded_by, note
    )
    values (
      v_provider,
      pay ->> 'provider_payment_id',
      v_sub.id,
      (pay ->> 'status')::public.payment_status,
      (pay ->> 'amount_minor')::bigint,
      (pay ->> 'currency')::public.currency,
      coalesce((pay ->> 'occurred_at')::timestamptz, v_occurred),
      coalesce(v_period_start, (pay ->> 'period_start')::timestamptz),
      coalesce(v_period_end, (pay ->> 'period_end')::timestamptz),
      pay ->> 'channel',
      v_sub.ambassador_id,
      (pay ->> 'recorded_by')::uuid,
      pay ->> 'note'
    )
    on conflict (provider, provider_payment_id) do nothing;
  end if;

  if p ? 'audit' then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (
      (p -> 'audit' ->> 'actor_id')::uuid,
      p -> 'audit' ->> 'action',
      'subscription',
      v_sub.id::text,
      coalesce(p -> 'audit' -> 'details', '{}'::jsonb)
    );
  end if;

  update public.billing_events set subscription_id = v_sub.id, processed_at = now()
  where provider = v_provider and event_id = v_event_id;

  return jsonb_build_object('result', 'applied', 'subscription_id', v_sub.id);
end;
$$;

-- Everything that can grant a student access: their own subscriptions plus group subscriptions
-- through an open seat. Evaluated by isStudentActive; nothing else decides access.
create function public.student_coverages(p_student_id uuid, p_at timestamptz default now())
returns table (
  subscription_id uuid,
  provider public.payment_provider,
  via text,
  status public.subscription_status,
  current_period_end timestamptz,
  trial_end timestamptz,
  grace_until timestamptz
)
language sql
stable
set search_path = ''
as $$
  select s.id, s.provider, 'direct', s.status, s.current_period_end, s.trial_end, s.grace_until
  from public.subscriptions s
  where s.student_id = p_student_id
  union all
  select s.id, s.provider, 'seat', s.status, s.current_period_end, s.trial_end, s.grace_until
  from public.seat_assignments a
  join public.subscriptions s on s.id = a.subscription_id
  where a.student_id = p_student_id
    and a.assigned_at <= p_at
    and (a.released_at is null or a.released_at > p_at)
$$;

revoke execute on function public.apply_billing_event(jsonb) from public, anon, authenticated;
revoke execute on function public.student_coverages(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_billing_event(jsonb) to service_role;
grant execute on function public.student_coverages(uuid, timestamptz) to service_role;

alter table public.subscriptions enable row level security;
alter table public.seat_assignments enable row level security;
alter table public.sponsor_links enable row level security;
alter table public.billing_events enable row level security;
alter table public.payments enable row level security;

create policy subscriptions_read on public.subscriptions for select to authenticated
  using (
    (select public.is_admin())
    or payer_id = (select auth.uid())
    or exists (select 1 from public.students st where st.id = student_id and st.owner_id = (select auth.uid()))
    or exists (
      select 1 from public.group_accounts g where g.id = group_account_id and g.owner_id = (select auth.uid())
    )
  );

create policy seat_assignments_read on public.seat_assignments for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.subscriptions s
      join public.group_accounts g on g.id = s.group_account_id
      where s.id = subscription_id and g.owner_id = (select auth.uid())
    )
  );

create policy sponsor_links_read on public.sponsor_links for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.students st where st.id = student_id and st.owner_id = (select auth.uid()))
  );

-- Payments are visible wherever their subscription is (the subquery is itself filtered by RLS).
create policy payments_read on public.payments for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.subscriptions s where s.id = subscription_id)
  );

create policy billing_events_read on public.billing_events for select to authenticated
  using ((select public.is_admin()));

-- ===== 20261002130000_payer_app.sql =====
-- Payer app (Phase 3): onboarding details, child extras, guardian consent links, co-sponsor
-- viewers, encouragement, group invites, and the practice data the dashboard reads (the question
-- bank and practice flows that write it come in Phases 5 and 6).

create type public.payer_type as enum ('sponsor', 'parent', 'group');
create type public.language as enum ('en', 'pcm');
create type public.question_status as enum ('draft', 'in_review', 'approved', 'retired');
create type public.practice_channel as enum ('whatsapp', 'web');
alter type public.consent_method add value if not exists 'guardian_link';

alter table public.payers
  add column payer_type public.payer_type not null default 'parent',
  -- Explicit opt-in to weekly reports on WhatsApp; null means no WhatsApp messages at all.
  add column whatsapp_reports_opt_in_at timestamptz,
  -- 0 = Sunday ... 6 = Saturday, in the payer's own timezone.
  add column report_weekday smallint not null default 0 check (report_weekday between 0 and 6),
  add column report_hour smallint not null default 18 check (report_hour between 0 and 23),
  add constraint whatsapp_reports_need_number
    check (whatsapp_reports_opt_in_at is null or whatsapp_number is not null);
alter table public.payers alter column payer_type drop default;

alter table public.students
  add column language public.language not null default 'en',
  add column exam_date date,
  -- Set for students who joined a group (class) through its invite link.
  add column group_account_id uuid references public.group_accounts (id) on delete set null;

create index students_group_idx on public.students (group_account_id);

-- A link the payer sends to the child's guardian when the payer is not the guardian. Only the
-- SHA-256 of the token is stored.
create table public.consent_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz
);

-- Co-sponsors who can see a child's progress (read only).
create table public.student_viewers (
  student_id uuid not null references public.students (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (student_id, viewer_id)
);

create table public.viewer_invites (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  token_hash text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null
);

-- "Send encouragement": delivered by the bot the next time the student starts practising.
create table public.encouragements (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  message text not null check (char_length(btrim(message)) between 1 and 160),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index encouragements_pending_idx on public.encouragements (student_id) where delivered_at is null;

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_account_id uuid not null references public.group_accounts (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Question bank (authoring and review UI in Phase 5).
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  subject public.subject not null,
  name text not null check (char_length(name) between 2 and 80),
  syllabus_ref text,
  created_at timestamptz not null default now(),
  unique (subject, name),
  unique (id, subject)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  subject public.subject not null,
  topic_id uuid not null,
  stem text not null check (char_length(stem) between 5 and 1000),
  options jsonb not null
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 5),
  answer_index smallint not null check (answer_index >= 0),
  explanation_en text not null,
  explanation_pcm text,
  syllabus_ref text,
  status public.question_status not null default 'draft',
  created_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  -- The topic must belong to the question's subject.
  foreign key (topic_id, subject) references public.topics (id, subject),
  constraint answer_in_options check (answer_index < jsonb_array_length(options)),
  constraint approved_by_a_teacher check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  channel public.practice_channel not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index practice_sessions_student_idx on public.practice_sessions (student_id, started_at desc);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_sessions (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  question_id uuid not null references public.questions (id),
  chosen_index smallint not null check (chosen_index >= 0),
  correct boolean not null,
  answered_at timestamptz not null default now(),
  unique (session_id, question_id)
);

create index answers_student_idx on public.answers (student_id, answered_at desc);

-- Only teacher-approved questions are ever put to students (CLAUDE.md).
create function public.answers_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.questions where id = new.question_id and status = 'approved') then
    raise exception 'only approved questions can be answered' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.practice_sessions where id = new.session_id and student_id = new.student_id
  ) then
    raise exception 'answer and session belong to different students' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger answers_guard
before insert or update of question_id, session_id, student_id on public.answers
for each row execute function public.answers_guard();

-- Who may see a student: the managing account, invited co-sponsors, and admins.
create function public.can_view_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.is_admin())
    or exists (
      select 1 from public.students s where s.id = p_student_id and s.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.student_viewers v
      where v.student_id = p_student_id and v.viewer_id = (select auth.uid())
    )
$$;

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = (select auth.uid()) and role in ('reviewer', 'admin')
  )
$$;

-- A student's answers with subject and topic, for the dashboard and weekly report. Payers can't
-- read the question bank itself, so this exposes only what progress needs.
create function public.student_answer_history(p_student_id uuid, p_since timestamptz)
returns table (
  answered_at timestamptz,
  correct boolean,
  subject public.subject,
  topic text,
  session_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.answered_at, a.correct, q.subject, t.name, a.session_id
  from public.answers a
  join public.questions q on q.id = a.question_id
  join public.topics t on t.id = q.topic_id
  where a.student_id = p_student_id
    and a.answered_at >= p_since
    and public.can_view_student(p_student_id)
  order by a.answered_at
$$;

-- Class leaderboard for a group owner: first name and initial only (CLAUDE.md).
create function public.group_week_stats(p_group_id uuid, p_since timestamptz, p_day_threshold integer)
returns table (
  student_id uuid,
  first_name text,
  last_initial text,
  answered bigint,
  correct bigint,
  practice_days bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select s.id, s.first_name, s.last_initial
    from public.students s
    join public.group_accounts g on g.id = s.group_account_id
    where s.group_account_id = p_group_id
      and (g.owner_id = (select auth.uid()) or (select public.is_admin()))
  ),
  per_day as (
    select a.student_id,
      (a.answered_at at time zone 'Africa/Lagos')::date as day,
      count(*) as n,
      count(*) filter (where a.correct) as c
    from public.answers a
    join members m on m.id = a.student_id
    where a.answered_at >= p_since
    group by 1, 2
  )
  select m.id, m.first_name, m.last_initial,
    coalesce(sum(p.n), 0)::bigint,
    coalesce(sum(p.c), 0)::bigint,
    count(p.day) filter (where p.n >= p_day_threshold)
  from members m
  left join per_day p on p.student_id = m.id
  group by m.id, m.first_name, m.last_initial
$$;

revoke execute on function public.student_answer_history(uuid, timestamptz) from public, anon;
revoke execute on function public.group_week_stats(uuid, timestamptz, integer) from public, anon;
grant execute on function public.student_answer_history(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.group_week_stats(uuid, timestamptz, integer) to authenticated, service_role;

-- Viewers can now see the students they were invited to.
drop policy students_read on public.students;
create policy students_read on public.students for select to authenticated
  using ((select public.can_view_student(id)));

drop policy guardian_consents_read on public.guardian_consents;
create policy guardian_consents_read on public.guardian_consents for select to authenticated
  using ((select public.can_view_student(student_id)));

alter table public.consent_requests enable row level security;
alter table public.student_viewers enable row level security;
alter table public.viewer_invites enable row level security;
alter table public.encouragements enable row level security;
alter table public.group_invites enable row level security;
alter table public.topics enable row level security;
alter table public.questions enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.answers enable row level security;

create policy consent_requests_read on public.consent_requests for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.students s where s.id = student_id and s.owner_id = (select auth.uid()))
  );

create policy student_viewers_read on public.student_viewers for select to authenticated
  using (
    viewer_id = (select auth.uid())
    or (select public.is_admin())
    or exists (select 1 from public.students s where s.id = student_id and s.owner_id = (select auth.uid()))
  );

create policy viewer_invites_read on public.viewer_invites for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.students s where s.id = student_id and s.owner_id = (select auth.uid()))
  );

create policy encouragements_read on public.encouragements for select to authenticated
  using ((select public.can_view_student(student_id)));

create policy group_invites_read on public.group_invites for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.group_accounts g where g.id = group_account_id and g.owner_id = (select auth.uid())
    )
  );

create policy topics_read on public.topics for select to authenticated using (true);

create policy questions_read on public.questions for select to authenticated
  using ((select public.is_staff()));

create policy practice_sessions_read on public.practice_sessions for select to authenticated
  using ((select public.can_view_student(student_id)));

create policy answers_read on public.answers for select to authenticated
  using ((select public.can_view_student(student_id)));

-- ===== 20261002140000_whatsapp.sql =====
-- WhatsApp bot (Phase 8): household contacts, the inbound job queue, the message log, and the
-- daily question set on practice sessions.

-- Siblings may share one household number, so the number is no longer unique per student.
alter table public.students drop constraint students_whatsapp_number_key;
create index students_whatsapp_idx on public.students (whatsapp_number) where whatsapp_number is not null;

-- One row per WhatsApp number we have heard from.
create table public.wa_contacts (
  phone text primary key check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Free-form replies are allowed only within 24 hours of this (WhatsApp rule).
  last_inbound_at timestamptz,
  -- STOP: no business-started messages at all until the contact sends START.
  opted_out_at timestamptz,
  -- Who is practising now, when several students share the number ("Who's practising today?").
  active_student_id uuid references public.students (id) on delete set null,
  active_until timestamptz,
  created_at timestamptz not null default now()
);

-- Inbound messages, stored before processing. The primary key is Meta's message id, so a
-- webhook retry inserts nothing and is never processed twice.
create table public.wa_jobs (
  message_id text primary key,
  phone text not null,
  message jsonb not null,
  sent_at timestamptz not null,
  simulated boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default now()
);

create index wa_jobs_pending_idx on public.wa_jobs (sent_at) where status in ('pending', 'processing');

-- Every message in and out (CLAUDE.md). Outbound bodies are KinPrep's own message objects.
create table public.message_log (
  id bigint generated always as identity primary key,
  direction text not null check (direction in ('in', 'out')),
  phone text not null,
  student_id uuid references public.students (id) on delete set null,
  wa_message_id text,
  kind text not null,
  body jsonb not null,
  -- received | sent | simulated | blocked | failed
  status text not null,
  error text,
  simulated boolean not null default false,
  created_at timestamptz not null default now()
);

create index message_log_phone_idx on public.message_log (phone, id);

-- The day's set lives on the session: which questions, how far the student has got.
alter table public.practice_sessions
  add column lagos_day date,
  add column question_ids uuid[] not null default '{}',
  add column position smallint not null default 0 check (position >= 0),
  -- answer: waiting for an answer to question_ids[position]; next: answered, waiting for "Next".
  add column awaiting text not null default 'answer' check (awaiting in ('answer', 'next')),
  add column completed_at timestamptz;

create unique index practice_sessions_daily_uq on public.practice_sessions (student_id, channel, lagos_day)
  where lagos_day is not null;

alter table public.wa_contacts enable row level security;
alter table public.wa_jobs enable row level security;
alter table public.message_log enable row level security;

create policy wa_contacts_read on public.wa_contacts for select to authenticated
  using ((select public.is_admin()));
create policy message_log_read on public.message_log for select to authenticated
  using ((select public.is_admin()));
-- wa_jobs: server only (no policies).

-- ===== 20261003090000_engine.sql =====
-- The daily-set engine (src/lib/engine): which classes a question suits, each student's rolling
-- accuracy per topic, spaced review of wrong answers, and bank-shortage events for the content team.

-- The classes a question is suitable for; the student's class must be one of them. Defaults to all
-- classes for existing questions; the question editor (Phase 5) sets it per question.
alter table public.questions
  add column classes public.student_class[] not null
    default '{JSS1,JSS2,SS1,SS2,SS3,UTME}'
    check (cardinality(classes) >= 1);

-- Weighted rolling accuracy per student and topic, updated on every answer (recordAttempt).
create table public.topic_mastery (
  student_id uuid not null references public.students (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  attempts integer not null check (attempts >= 1),
  correct integer not null check (correct between 0 and attempts),
  accuracy numeric(5, 4) not null check (accuracy between 0 and 1),
  last_attempt_at timestamptz not null,
  primary key (student_id, topic_id)
);

-- Spaced review: a wrong answer comes back after 1 day, then 3, then 7 (src/lib/engine/mastery.ts).
create table public.question_reviews (
  student_id uuid not null references public.students (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  -- Reviews answered correctly since the last wrong answer.
  step smallint not null default 0 check (step >= 0),
  -- Start of the Lagos day it is due; null once the review cycle is complete.
  next_review_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (student_id, question_id)
);

create index question_reviews_due_idx on public.question_reviews (student_id, next_review_at)
  where next_review_at is not null;

-- Engine events for admin: for now, "the bank couldn't fill a student's set", per subject and topic.
create table public.engine_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('bank_shortage')),
  student_id uuid not null references public.students (id) on delete cascade,
  subject public.subject not null,
  topic_id uuid not null,
  lagos_day date not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (topic_id, subject) references public.topics (id, subject) on delete cascade
);

-- One event per student, day and topic, however often the set is looked at.
create unique index engine_events_daily_uq
  on public.engine_events (kind, student_id, lagos_day, topic_id);
create index engine_events_recent_idx on public.engine_events (kind, lagos_day desc, subject);

-- Why each question is in the set (review, weak, new, fill, topup), in question order.
alter table public.practice_sessions
  add column pick_reasons text[] not null default '{}';

alter table public.topic_mastery enable row level security;
alter table public.question_reviews enable row level security;
alter table public.engine_events enable row level security;

-- Payers (and co-sponsors) may see their children's mastery; admins see everything. Writes are
-- server-only (the engine uses the direct database connection).
create policy topic_mastery_read on public.topic_mastery for select to authenticated
  using ((select public.can_view_student(student_id)));
create policy question_reviews_read on public.question_reviews for select to authenticated
  using ((select public.can_view_student(student_id)));
create policy engine_events_read on public.engine_events for select to authenticated
  using ((select public.is_admin()));

-- ===== 20261003120000_jobs.sql =====
-- Scheduled jobs and the outbound message queue (src/lib/jobs).

-- A senior's opt-in to messages KinPrep starts on WhatsApp (morning message, evening reminder):
-- ticked by the parent when adding them, or recorded when the student sends START. STOP
-- (wa_contacts.opted_out_at) always wins.
alter table public.students add column whatsapp_opt_in_at timestamptz;

comment on column public.payers.whatsapp_reports_opt_in_at is
  'Payer opted in to KinPrep WhatsApp messages (weekly report, junior practice link, missed-days alerts). Null: email instead.';

-- Weekly reports go out between Saturday evening and Sunday night, at the payer's chosen hour in
-- their own timezone: Saturday 18:00-23:00 or Sunday 07:00-21:00.
update public.payers set report_weekday = 0, report_hour = 18
where not ((report_weekday = 6 and report_hour between 18 and 23)
        or (report_weekday = 0 and report_hour between 7 and 21));
alter table public.payers add constraint report_time_in_window check (
  (report_weekday = 6 and report_hour between 18 and 23)
  or (report_weekday = 0 and report_hour between 7 and 21)
);

-- Every message a job wants to send. The dedupe key makes each job safe to run twice: one send per
-- student (or household number, or payer) per day per job. Dry runs are recorded apart, so a dry
-- run never stops the real one.
create table public.outbound_queue (
  id bigint generated always as identity primary key,
  job text not null
    check (job in ('morning', 'junior_link', 'reminder', 'missed_days', 'weekly_report')),
  dedupe_key text not null,
  dry_run boolean not null default false,
  channel text not null check (channel in ('whatsapp', 'email')),
  -- E.164 number or email address.
  recipient text not null,
  student_id uuid references public.students (id) on delete cascade,
  payer_id uuid references public.profiles (id) on delete cascade,
  -- WhatsApp template name (src/config/templates.ts), or null for email.
  template text,
  -- Meta's category (utility, marketing, authentication), or 'email'.
  category text not null,
  -- The WhatsApp template message or the email, ready to send.
  payload jsonb not null,
  -- The text the recipient will read, for admins and dry runs.
  preview text not null,
  lagos_day date not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'blocked', 'failed', 'dry_run')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- Not worth sending after this (a morning message at night): marked failed instead.
  expires_at timestamptz not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  estimated_cost_usd numeric(8, 4),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (dedupe_key, dry_run)
);

create index outbound_queue_due_idx on public.outbound_queue (next_attempt_at, id)
  where status in ('pending', 'sending') and not dry_run;
create index outbound_queue_sent_idx on public.outbound_queue (channel, sent_at)
  where status = 'sent';

-- "Missed 2 days in a row": one row per lapse, shown on the payer dashboard until the student
-- practises again.
create table public.student_alerts (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students (id) on delete cascade,
  kind text not null check (kind in ('missed_days')),
  -- First day of the lapse (Lagos).
  since_day date not null,
  days smallint not null check (days >= 1),
  created_at timestamptz not null default now(),
  unique (student_id, kind, since_day)
);

-- Every send is logged with its template, category and estimated cost; emails too.
alter table public.message_log
  alter column phone drop not null,
  add column email text,
  add column template text,
  add column category text,
  add column estimated_cost_usd numeric(8, 4),
  add column queue_id bigint references public.outbound_queue (id) on delete set null,
  add constraint message_log_has_recipient check (phone is not null or email is not null);

alter table public.outbound_queue enable row level security;
alter table public.student_alerts enable row level security;

create policy outbound_queue_read on public.outbound_queue for select to authenticated
  using ((select public.is_admin()));
create policy student_alerts_read on public.student_alerts for select to authenticated
  using ((select public.can_view_student(student_id)));

-- ===== 20261003150000_question_bank.sql =====
-- The question bank (/admin/questions): syllabus mapping, where each question came from, the
-- reviewer's checks, the review log reviewers are paid from, and re-check flags.

alter type public.question_status add value if not exists 'rejected';

create type public.question_source as enum ('human', 'ai_draft', 'import');

-- Each topic maps to the published JAMB (UTME) and WAEC (WASSCE) syllabus.
alter table public.topics
  add column jamb_ref text check (char_length(jamb_ref) <= 200),
  add column waec_ref text check (char_length(waec_ref) <= 200),
  add column sort_order integer not null default 0;

-- Questions written before this change were teacher-approved originals.
alter table public.questions
  add column source public.question_source not null default 'human',
  -- "Original question, not from a past paper", ticked by the writer or the reviewer.
  add column original_confirmed boolean not null default false,
  -- For AI drafts the reviewer must confirm both the answer and the explanation.
  add column answer_checked boolean not null default false,
  add column explanation_checked boolean not null default false,
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz,
  add column rejection_reason text check (char_length(rejection_reason) <= 500),
  -- Sent back for re-checking (e.g. an unusually low correct rate). Stays approved, so today's
  -- sets still work, but buildDailySet won't pick it until a reviewer clears or fixes it.
  add column flagged_at timestamptz,
  add column flag_reason text check (char_length(flag_reason) <= 500),
  add column updated_at timestamptz not null default now();

update public.questions set original_confirmed = true where status = 'approved';

alter table public.questions
  add constraint approved_is_original check (status <> 'approved' or original_confirmed),
  add constraint approved_ai_draft_checked check (
    status <> 'approved' or source <> 'ai_draft' or (answer_checked and explanation_checked)
  );

create index questions_queue_idx on public.questions (status, created_at);

-- Every review decision, for the audit trail and for paying reviewers per question.
create table public.question_review_log (
  id bigint generated always as identity primary key,
  question_id uuid not null references public.questions (id) on delete cascade,
  reviewer_id uuid references public.profiles (id) on delete set null,
  action text not null
    check (action in ('approved', 'edited_approved', 'rejected', 'flagged', 'cleared', 'retired')),
  source public.question_source not null,
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

create index question_review_log_reviewer_idx on public.question_review_log (reviewer_id, created_at);

alter table public.question_review_log enable row level security;
create policy question_review_log_read on public.question_review_log for select to authenticated
  using ((select public.is_staff()));

-- ===== 20261003180000_admin.sql =====
-- The admin console (/admin): pausing students, the pilot console's hand-sent messages, and
-- ambassador payouts.

-- An admin can pause a student (a family's request, a holiday): no practice and no messages
-- while paused, whatever is paid. isStudentActive checks it.
alter table public.students
  add column paused_at timestamptz,
  add column paused_reason text check (char_length(paused_reason) <= 300);

-- Pilot console: messages prepared for an admin to send by hand from the WhatsApp Business app
-- (before the Cloud API is live). Same dedupe keys as the scheduled jobs, so nothing goes twice.
alter table public.outbound_queue drop constraint outbound_queue_status_check;
alter table public.outbound_queue add constraint outbound_queue_status_check
  check (status in ('pending', 'sending', 'sent', 'blocked', 'failed', 'dry_run', 'manual'));
alter table public.outbound_queue drop constraint outbound_queue_job_check;
alter table public.outbound_queue add constraint outbound_queue_job_check
  check (job in ('morning', 'junior_link', 'reminder', 'missed_days', 'weekly_report', 'practice_link'));
alter table public.outbound_queue add column sent_by uuid references public.profiles (id) on delete set null;
create index outbound_queue_manual_idx on public.outbound_queue (lagos_day, job) where status = 'manual';

-- How each ambassador is paid: Paystack Transfers to a Nigerian bank account, Stripe Connect
-- Express for UK accounts, or by hand. Only the provider's recipient/account id and the last four
-- digits are kept, never a full account number.
alter table public.ambassadors
  add column email text check (char_length(email) <= 200),
  add column payout_country text not null default 'NG' check (payout_country in ('NG', 'GB')),
  add column payout_method text not null default 'manual'
    check (payout_method in ('paystack', 'stripe_connect', 'manual')),
  add column paystack_recipient_code text check (paystack_recipient_code ~ '^RCP_'),
  add column bank_name text check (char_length(bank_name) <= 80),
  add column account_last4 text check (account_last4 ~ '^[0-9]{4}$'),
  add column stripe_account_id text check (stripe_account_id ~ '^acct_'),
  add column updated_at timestamptz not null default now();

-- A month's commission payouts, prepared, checked by an admin, then confirmed (paid out).
create table public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  -- First day of the month the commissions were earned in (Lagos).
  month date not null check (extract(day from month) = 1),
  status text not null default 'prepared' check (status in ('prepared', 'confirmed')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz
);

create table public.ambassador_payouts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payout_batches (id) on delete cascade,
  ambassador_id uuid not null references public.ambassadors (id) on delete restrict,
  currency public.currency not null,
  amount_minor bigint not null check (amount_minor > 0),
  method text not null check (method in ('paystack', 'stripe_connect', 'manual')),
  status text not null default 'prepared'
    check (status in ('prepared', 'sending', 'paid', 'failed')),
  provider_ref text,
  error text,
  paid_at timestamptz,
  paid_by uuid references public.profiles (id) on delete set null,
  unique (batch_id, ambassador_id, currency)
);

-- Which payments each payout covers: a payment's commission is paid at most once.
create table public.commission_items (
  payment_id uuid primary key references public.payments (id) on delete restrict,
  payout_id uuid not null references public.ambassador_payouts (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0)
);

alter table public.payout_batches enable row level security;
alter table public.ambassador_payouts enable row level security;
alter table public.commission_items enable row level security;
create policy payout_batches_read on public.payout_batches for select to authenticated
  using ((select public.is_admin()));
create policy ambassador_payouts_read on public.ambassador_payouts for select to authenticated
  using ((select public.is_admin()));
create policy commission_items_read on public.commission_items for select to authenticated
  using ((select public.is_admin()));

-- ===== 20261004090000_ai_explain.sql =====
-- AI "Explain another way" (src/lib/ai): cached explanations and a log of every request.

-- One explanation per question, language and wrong option (and prompt version), so a repeat costs
-- nothing. An admin can flag a bad one: it stops being served and the next request makes a new one.
create table public.ai_explanations (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  language text not null check (language in ('en', 'pcm')),
  -- The wrong option the student chose (0 = A), or -1 when they answered right.
  wrong_option smallint not null check (wrong_option between -1 and 4),
  prompt_version text not null,
  text text not null check (char_length(text) between 1 and 2000),
  model text not null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cost_usd numeric(10, 6) not null check (cost_usd >= 0),
  uses integer not null default 1,
  created_at timestamptz not null default now(),
  flagged_at timestamptz,
  flagged_by uuid references public.profiles (id) on delete set null,
  flag_reason text check (char_length(flag_reason) <= 500)
);

create unique index ai_explanations_cache_uq
  on public.ai_explanations (question_id, language, wrong_option, prompt_version)
  where flagged_at is null;

-- Every request, served or not: who, which question, how (fresh, cached, over the daily limit,
-- refused, or the teacher's explanation instead), the prompt version, tokens and cost.
create table public.ai_explanation_requests (
  id bigint generated always as identity primary key,
  student_id uuid references public.students (id) on delete cascade,
  question_id uuid references public.questions (id) on delete cascade,
  language text check (language in ('en', 'pcm')),
  wrong_option smallint,
  outcome text not null check (outcome in ('model', 'cache', 'limit', 'refused', 'fallback')),
  reason text check (char_length(reason) <= 300),
  explanation_id uuid references public.ai_explanations (id) on delete set null,
  prompt_version text not null,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  lagos_day date not null,
  created_at timestamptz not null default now()
);

create index ai_explanation_requests_daily_idx
  on public.ai_explanation_requests (student_id, lagos_day);

-- Editing a question's content makes its AI explanations stale: drop them.
create function public.ai_explanations_invalidate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stem is distinct from old.stem or new.options is distinct from old.options
     or new.answer_index is distinct from old.answer_index
     or new.explanation_en is distinct from old.explanation_en
     or new.explanation_pcm is distinct from old.explanation_pcm
     or new.topic_id is distinct from old.topic_id then
    delete from public.ai_explanations where question_id = new.id;
  end if;
  return new;
end;
$$;

create trigger ai_explanations_invalidate
after update on public.questions
for each row execute function public.ai_explanations_invalidate();

alter table public.ai_explanations enable row level security;
alter table public.ai_explanation_requests enable row level security;
create policy ai_explanations_read on public.ai_explanations for select to authenticated
  using ((select public.is_admin()));
create policy ai_explanation_requests_read on public.ai_explanation_requests for select to authenticated
  using ((select public.is_admin()));

-- ===== 20261004120000_hardening.sql =====
-- Hardening before launch: rate limits on public routes, and data retention.

-- Fixed-window request counters for public routes (sign-in, sponsor links, webhooks...). The key
-- is an HMAC of the caller's IP address or email, never the raw value; rows are deleted by the
-- daily maintenance job once their window has passed.
create table public.rate_limits (
  bucket text not null check (char_length(bucket) between 1 and 40),
  key text not null check (char_length(key) between 1 and 128),
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (bucket, key, window_start)
);

create index rate_limits_window_idx on public.rate_limits (window_start);

-- Server-only: no policies, so signed-in users and the anon key can't read or write it.
alter table public.rate_limits enable row level security;

-- Counts one request and returns the window's total (including this one), atomically.
create function public.rate_limit_hit(p_bucket text, p_key text, p_window_start timestamptz)
returns integer
language sql
set search_path = ''
as $$
  insert into public.rate_limits as r (bucket, key, window_start)
  values (p_bucket, p_key, p_window_start)
  on conflict (bucket, key, window_start) do update set hits = r.hits + 1
  returning hits
$$;

revoke all on function public.rate_limit_hit(text, text, timestamptz) from public, anon, authenticated;

-- ===== Migration history =====
-- Tells the Supabase CLI these migrations are applied, so `npm run db:push` skips them.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261002120000', 'core'),
  ('20261002120100', 'billing'),
  ('20261002130000', 'payer_app'),
  ('20261002140000', 'whatsapp'),
  ('20261003090000', 'engine'),
  ('20261003120000', 'jobs'),
  ('20261003150000', 'question_bank'),
  ('20261003180000', 'admin'),
  ('20261004090000', 'ai_explain'),
  ('20261004120000', 'hardening')
on conflict (version) do nothing;
