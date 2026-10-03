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
