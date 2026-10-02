-- Billing: subscriptions, bulk seats, sponsor links, webhook events and the payments ledger.
-- Provider code (src/lib/payments) turns each verified webhook into a provider-neutral update and
-- calls apply_billing_event, which records the event id (idempotency), updates the subscription
-- and writes the ledger in one transaction. Access is decided only by isStudentActive
-- (src/lib/payments/access.ts) from student_coverages below.

create type public.payment_provider as enum ('stripe', 'paystack', 'manual');
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
