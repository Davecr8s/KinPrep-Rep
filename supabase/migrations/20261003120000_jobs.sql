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
