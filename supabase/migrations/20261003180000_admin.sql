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
