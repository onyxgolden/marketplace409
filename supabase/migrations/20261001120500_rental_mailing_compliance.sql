-- Mailing Manager compliance fixes (Rentec parity R20, ChatGPT GO WITH FIXES)
-- AUTHORED, NOT APPLIED. Jason applies migrations.
--
-- 1. Certified-mail evidence invariant, enforced at the database level: a
--    letter row may only claim mailed/delivered while it carries a tracking
--    number. The manual PATCH route additionally requires a tracking number
--    before entering mailed and refuses tracking changes once delivered
--    unless the delivery is first reversed under the correction workflow
--    (see assertMailingEvidenceRules in src/domains/rental-mailing/mailingLetters.js).
-- 2. rental_mail_letter_events: the compliance audit trail. Every status
--    move and every tracking set/change/clear is stamped with the actor and
--    the old/new values, so corrections are visible instead of silently
--    rewriting the evidence.
--
-- Additive only: one check constraint on rental_mail_letters, one new table.

alter table if exists rental_mail_letters
  drop constraint if exists rental_mail_letters_tracking_required_for_mailed;

alter table if exists rental_mail_letters
  add constraint rental_mail_letters_tracking_required_for_mailed
  check (status not in ('mailed', 'delivered')
         or (tracking_number is not null and btrim(tracking_number) <> ''));

create table if not exists rental_mail_letter_events (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  letter_id text not null,
  event_type text not null check (event_type in ('status_changed', 'tracking_set', 'tracking_changed', 'tracking_cleared')),
  actor_user_id text,
  details jsonb,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, letter_id) references rental_mail_letters (owner_id, id) on delete cascade
);

create index if not exists idx_rental_mail_letter_events_letter
  on rental_mail_letter_events (owner_id, letter_id, created_at desc);

alter table rental_mail_letter_events enable row level security;
alter table rental_mail_letter_events force row level security;

drop policy if exists "rental_mail_letter_events_owner_select" on rental_mail_letter_events;
create policy "rental_mail_letter_events_owner_select" on rental_mail_letter_events for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_mail_letter_events_owner_insert" on rental_mail_letter_events;
create policy "rental_mail_letter_events_owner_insert" on rental_mail_letter_events for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_mail_letter_events_owner_update" on rental_mail_letter_events;
create policy "rental_mail_letter_events_owner_update" on rental_mail_letter_events for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_mail_letter_events_owner_delete" on rental_mail_letter_events;
create policy "rental_mail_letter_events_owner_delete" on rental_mail_letter_events for delete to authenticated
  using (has_workspace_access(owner_id));

revoke all on rental_mail_letter_events from anon, authenticated;
grant select, insert, update, delete on rental_mail_letter_events to authenticated;
