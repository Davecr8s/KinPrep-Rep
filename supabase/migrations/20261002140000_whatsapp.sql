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
