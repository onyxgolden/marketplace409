-- LOGIN SAFETY (slice 1): user_security_settings.
--
-- Per-account login-safety preferences. alert_on_new_location drives the
-- slice-1 email ("we've never seen a sign-in from here"). The Rentec-style
-- hard restriction (restrict_to_known_locations) is stored but UNENFORCED in
-- this slice -- proxy.js is untouched; a future slice may read it as an
-- enforcement point. Both default to the safe side: alert on, block off.

create table if not exists user_security_settings (
  user_id uuid not null primary key references auth.users (id) on delete cascade,
  alert_on_new_location boolean not null default true,
  restrict_to_known_locations boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table user_security_settings enable row level security;

alter table user_security_settings force row level security;

create policy "user_security_settings_select_own"
on user_security_settings
for select
to authenticated
using (user_id = auth.uid());

create policy "user_security_settings_insert_own"
on user_security_settings
for insert
to authenticated
with check (user_id = auth.uid());

create policy "user_security_settings_update_own"
on user_security_settings
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
