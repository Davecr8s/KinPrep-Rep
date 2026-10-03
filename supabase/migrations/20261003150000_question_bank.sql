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
