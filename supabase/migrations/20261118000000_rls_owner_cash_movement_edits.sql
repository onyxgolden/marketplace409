-- Lock down owner_cash_movement_edits: enable RLS + owner-only policies.
--
-- Verified live (Muse, read-only, Nov 17 2026): Row Level Security was OFF
-- on public.owner_cash_movement_edits, with full grants (arwdDxtm) to BOTH
-- anon and authenticated. 0 rows at the time — nothing has leaked — but any
-- future row would have been publicly readable/writable by anyone holding
-- the project's publishable key, authenticated or not. This table is the
-- audit trail for update_owner_movement() (20261101020000): one row per
-- edit to an active owner cash movement, carrying before/after values.
--
-- This migration enables + forces RLS and adds owner-scoped policies using
-- has_workspace_access(owner_id) (20260829000100) — the same workspace-
-- owner-path predicate owner_cash_movements itself already uses
-- (20261001010000) and financial_snapshots was hardened with
-- (20260923093000, PR #328).
--
-- Also removes the public exposure at the ACL layer, not just RLS: the
-- project's default privileges grant ALL on new tables to
-- anon/authenticated/service_role, so a selective GRANT alone would not
-- have removed anything already in place. REVOKE ALL first, then GRANT
-- back only what the app actually uses for this table: SELECT (the
-- /api/rental/owner-movement-edits GET route reads it directly as the
-- authenticated user) and INSERT (update_owner_movement() is SECURITY
-- INVOKER, not DEFINER — its own `insert into owner_cash_movement_edits`
-- runs as the calling authenticated role, so that role needs a real
-- INSERT grant, not just a passing RLS check). No UPDATE/DELETE grant: no
-- application code path ever updates or deletes an edit-audit row, and
-- omitting the grant (on top of having no UPDATE/DELETE policy) keeps the
-- table append-only at both the ACL and RLS layers. anon and service_role
-- get nothing — this table is never read through a service-role path.
--
-- NOT APPLIED BY THIS BRANCH. Production apply is Muse's step after
-- ChatGPT review + merge + Jason's separate word, same gate every other
-- migration in this repo uses.

alter table public.owner_cash_movement_edits enable row level security;
alter table public.owner_cash_movement_edits force row level security;

revoke all on table public.owner_cash_movement_edits from public, anon, authenticated, service_role;
grant select, insert on table public.owner_cash_movement_edits to authenticated;

drop policy if exists "owner_cash_movement_edits_owner_select" on public.owner_cash_movement_edits;
create policy "owner_cash_movement_edits_owner_select" on public.owner_cash_movement_edits for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "owner_cash_movement_edits_owner_insert" on public.owner_cash_movement_edits;
create policy "owner_cash_movement_edits_owner_insert" on public.owner_cash_movement_edits for insert to authenticated
  with check (has_workspace_access(owner_id));
