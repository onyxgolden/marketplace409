-- LOGIN SAFETY (slice 1 fix): flag the exact sign-in event on "Wasn't me".
--
-- Adds login_history.flagged_suspicious, set to true by the verify-location
-- route (service role) when the owner clicks "No, this wasn't me". The
-- history stays append-only for application callers (no UPDATE policy for
-- authenticated users); only the service-role verify path writes this flag.

alter table login_history
  add column if not exists flagged_suspicious boolean not null default false;

comment on column login_history.flagged_suspicious is
  'Set true when the account owner clicks "Wasn''t me" on the new-sign-in alert for this exact event.';
