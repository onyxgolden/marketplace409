-- Shared FORGE workspace membership -- Checkpoint 1 continued. Two authorization helpers, both
-- reading only workspace_members, so RLS policies/RPC guards and the JS-side owner resolution can
-- never disagree with each other -- there is exactly one source of truth.
--
-- has_workspace_access(p_owner_id) -- boolean predicate replacing `owner_id = auth.uid()::text`
-- verbatim in RLS `using`/`with check` clauses and RPC guards (`if not has_workspace_access(p_owner_id)
-- then raise`). Two overloads (text and uuid) since 5 tables in this codebase type owner_id as uuid
-- while the other ~85 type it text -- see the workspace-membership plan for the full inventory.
--
-- resolve_effective_owner_id(p_actor) -- scalar, returns the owner_id whose workspace p_actor is
-- currently authorized to act within (their own uid if they're a primary owner or have no active
-- co-owner membership, otherwise the owner_id of the single workspace they're an active co-owner
-- of). This is what fixes the write-time bug found during Phase 1 inspection: several SECURITY
-- INVOKER RPCs (e.g. create_financial_asset_with_valuation) derive `v_owner_id := auth.uid()` and
-- use that as the value they WRITE, not just a check -- if a co-owner called them unchanged, they'd
-- silently create data under their own owner_id instead of the shared workspace's. Those RPCs get
-- updated in later checkpoints to use resolve_effective_owner_id() instead of bare auth.uid().
--
-- security definer + row_security off, matching the established rental_actor_has_lease_access
-- pattern (20260812000100_create_rental_identity.sql) -- these are meant to be called from inside
-- RLS policies on OTHER tables, so they need to read workspace_members reliably regardless of the
-- calling context's own RLS visibility into it.

create or replace function public.has_workspace_access(p_owner_id text)
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
              and status = 'active'
              and role = 'co_owner'
        );
$$;

create or replace function public.has_workspace_access(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
    select public.has_workspace_access(p_owner_id::text);
$$;

create or replace function public.resolve_effective_owner_id(p_actor uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
    select coalesce(
        (select owner_id from workspace_members
         where member_user_id = p_actor and status = 'active' and role = 'co_owner'
         limit 1),
        p_actor::text
    );
$$;

revoke all on function public.has_workspace_access(text) from public;
revoke all on function public.has_workspace_access(uuid) from public;
revoke all on function public.resolve_effective_owner_id(uuid) from public;
grant execute on function public.has_workspace_access(text) to authenticated;
grant execute on function public.has_workspace_access(uuid) to authenticated;
grant execute on function public.resolve_effective_owner_id(uuid) to authenticated;
