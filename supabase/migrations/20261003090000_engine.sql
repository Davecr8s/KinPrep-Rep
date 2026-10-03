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
