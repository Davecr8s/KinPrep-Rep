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
