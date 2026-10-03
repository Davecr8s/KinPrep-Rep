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
