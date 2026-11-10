-- Rental admin slice 1 — R17 foundation repair (2026-11-10).
--
-- ROOT CAUSE: the two R17 migrations (20261001060000, 20261001070500) were never
-- applied to production, so the foundation slice 1 stands on is missing live:
--   * workspace_members.permission_overrides (jsonb) — the column the
--     slice-1 has_rental_permission() reads for every non-owner caller.
--   * has_workspace_visibility(text) — the read boundary the admin page's
--     authorization calls (src/lib/rental/adminRoleAuthorization.js).
-- Without the column, has_rental_permission() errors (42703) for any non-owner,
-- which breaks the 8 new slice-1 RLS policies for Brandy (co-owner) and blocks
-- starter-role setup ("Failed to resolve team membership").
--
-- FIX: restore ONLY the two missing pieces, VERBATIM from the R17 files:
--   * column: 20261001060000 line 67 (alter table ... add column if not exists)
--   * function + comment: 20261001070500 lines 63-84
-- Deliberately NOT included (must not be overwritten):
--   * has_rental_permission — slice-1 version (with the role-table branch) is
--     already live from 20261110010000; the R17 version would clobber it.
--   * has_workspace_access — already live, owner + active co-owner only.
--   * update_workspace_member — also missing live, but it is a pre-existing
--     Team-route gap with its own dependencies (team_management_owner_id(),
--     workspace_member_audit); separate fix, not a slice-1 dependency.
-- Grants: verbatim R17 text — no revoke/grant lines in the R17 file for these
-- objects. has_workspace_visibility is a read-only boolean about the caller
-- (auth.uid()); anon always gets false. Same reasoning as has_rental_permission.
-- After this apply, file the identical text as a repo migration PR so the repo
-- matches live (file is idempotent: if not exists / create or replace).

alter table workspace_members
    add column if not exists permission_overrides jsonb not null default '{}';

create or replace function public.has_workspace_visibility(p_owner_id text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
    select p_owner_id = auth.uid()::text
        or exists (
            select 1 from workspace_members
            where owner_id = p_owner_id
              and member_user_id = auth.uid()
              and coalesce(status, 'active') = 'active'
        );
$$;

comment on function public.has_workspace_visibility(text) is
'Read/workspace visibility boundary: true for the owner or any active workspace member. '
'Does NOT grant writes; writes require has_workspace_access() (privileged) or '
'has_rental_permission() (staff, permission-gated).';
