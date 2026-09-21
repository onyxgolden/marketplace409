-- Shared FORGE workspace membership -- converts the designer_projects owner policy from
-- `owner_id = auth.uid()::text` to `has_workspace_access(owner_id)` so an active co-owner gets
-- the same access as the primary owner. The designer API routes resolve the acting user to their
-- effective owner (resolveEffectiveOwnerId, the JS twin of resolve_effective_owner_id()) and query
-- / write rows under that canonical owner_id; without this conversion a co-owner's reads and
-- writes under the shared workspace owner_id would be rejected or mis-attributed at the DB layer.
--
-- Historical migration files are never edited -- this new migration only drops and recreates the
-- specific named policy below, layered on top of 20260920060000_create_designer_projects.sql.

drop policy "designer_projects_owner_all" on designer_projects;
create policy "designer_projects_owner_all" on designer_projects for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
