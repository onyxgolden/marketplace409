-- LOGIN SAFETY (slice 1): login_history.
--
-- Append-only record of sign-in events for new-location alerting. Rows are
-- created by the record-login server route on every SIGNED_IN event; no
-- UPDATE or DELETE policy exists, so history cannot be rewritten through the
-- application. The (user_id, session_id, result) unique key gives the route a
-- server-side dedup: the same sign-in event reported twice (two surfaces,
-- re-render) inserts exactly once via ON CONFLICT DO NOTHING.
--
-- NULL country/city means "unknown location" (geo headers absent) -- alerts
-- still fire, they just say unknown location instead of a city.

create table if not exists login_history (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  session_id text,
  ip_address text,
  user_agent text,
  country text,
  city text,
  result text not null check (result in ('success', 'failed')),
  unique (user_id, session_id, result)
);

create index if not exists idx_login_history_user_occurred
  on login_history (user_id, occurred_at desc);

alter table login_history enable row level security;

alter table login_history force row level security;

-- Owners read their own sign-in history only. Inserts go through the
-- record_login_event() RPC below (which binds user_id to auth.uid()),
-- but the table also permits direct session inserts for future callers.
create policy "login_history_select_own"
on login_history
for select
to authenticated
using (user_id = auth.uid());

create policy "login_history_insert_own"
on login_history
for insert
to authenticated
with check (user_id = auth.uid());

-- Atomic insert-or-dedup for the record-login route. user_id is bound to
-- auth.uid() inside the function -- the caller can never supply someone
-- else's user id. Returns the row id and whether this call was a duplicate
-- of an already-recorded event.
create or replace function record_login_event(
  p_session_id text,
  p_ip_address text,
  p_user_agent text,
  p_country text,
  p_city text,
  p_result text
)
returns table (login_id uuid, was_duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_login_id uuid;
begin
  if v_user_id is null then
    raise exception 'record_login_event requires an authenticated user';
  end if;
  if p_result not in ('success', 'failed') then
    raise exception 'record_login_event: invalid result';
  end if;

  insert into login_history (user_id, session_id, ip_address, user_agent, country, city, result)
  values (v_user_id, nullif(p_session_id, ''), p_ip_address, p_user_agent, p_country, p_city, p_result)
  on conflict (user_id, session_id, result) do nothing
  returning login_history.id into v_login_id;

  if v_login_id is null then
    -- Duplicate: return the already-recorded row id so the caller can stop.
    select login_history.id into v_login_id
    from login_history
    where login_history.user_id = v_user_id
      and login_history.session_id is not distinct from nullif(p_session_id, '')
      and login_history.result = p_result
    limit 1;
    return query select v_login_id, true;
  end if;

  return query select v_login_id, false;
end;
$$;

revoke all on function record_login_event(text, text, text, text, text, text) from public;
grant execute on function record_login_event(text, text, text, text, text, text) to authenticated;
