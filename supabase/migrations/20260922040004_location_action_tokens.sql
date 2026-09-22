-- LOGIN SAFETY (slice 1): location_action_tokens.
--
-- One-time tokens behind the "Yes, this was me" / "Wasn't me" links in the
-- new-sign-in alert email. Only the SHA-256 hex of each token is stored;
-- the raw token exists solely inside the emailed URL. Each token is
-- single-use (used_at), expires after 24 hours, and is consumed BEFORE the
-- approve/deny action is applied, so a replayed link cannot act twice.
--
-- RLS is enabled with NO permissive policies: only the service role (the
-- record-login / verify-location server routes) can read or write this
-- table. Authenticated sessions get nothing.

create table if not exists location_action_tokens (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  action text not null check (action in ('approve', 'deny')),
  login_history_id uuid references login_history (id) on delete cascade,
  country text,
  city text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_location_action_tokens_user
  on location_action_tokens (user_id, created_at desc);

alter table location_action_tokens enable row level security;

alter table location_action_tokens force row level security;

-- Deliberately no policies: with RLS enabled and forced and zero permissive
-- policies, only the service role bypasses RLS. All inserts/selects/updates
-- happen in the record-login and verify-location server routes via the
-- service-role client; browser sessions can never read or mint tokens.
