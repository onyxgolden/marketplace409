-- Shared FORGE workspace membership (co_owner access) -- Checkpoint 1 of the workspace-membership
-- build-out. Adds the membership model only; RLS/RPC conversion for Rental Manager and Financial
-- FORGE happens in later checkpoints on this same branch.
--
-- Design decision: primary_owner is IMPLICIT, never a row in this table -- `owner_id = auth.uid()`
-- always means primary owner. This means zero backfill and zero risk to existing owner_id data:
-- workspace_members only ever gains rows for actual co-owners (and, in a future slice, manager/
-- bookkeeper/read_only members). The `role <> 'primary_owner'` check enforces this structurally.
--
-- Design decision: one active workspace per member. A member_user_id can be an active co-owner of
-- exactly one owner_id at a time (enforced by the partial unique index below, not just at the
-- application layer) -- matches the actual request (one spouse, one shared workspace) without
-- building unneeded generality. Extending to multi-workspace membership later would only require
-- relaxing that index, not a schema change.
--
-- role accepts all 5 P6-style values now (primary_owner is rejected by the check constraint since
-- it's implicit, so in practice only co_owner/manager/bookkeeper/read_only can ever be inserted),
-- but only co_owner is recognized by the authorization helpers added in the next migration --
-- manager/bookkeeper/read_only rows are structurally valid but functionally inert until a future
-- slice extends the helpers.

create table if not exists workspace_members (
    owner_id text not null,
    id text not null,
    member_user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('primary_owner', 'co_owner', 'manager', 'bookkeeper', 'read_only')),
    status text not null check (status in ('invited', 'active', 'suspended')) default 'invited',
    invited_email text not null check (btrim(invited_email) <> ''),
    invited_by uuid not null references auth.users(id),
    invited_at timestamptz not null default now(),
    activated_at timestamptz,
    suspended_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, member_user_id),
    check (role <> 'primary_owner'),
    check (status <> 'invited' or (activated_at is null and suspended_at is null)),
    check (status <> 'active' or activated_at is not null),
    check (status <> 'suspended' or (activated_at is not null and suspended_at is not null))
);

-- Defense in depth for the "one active workspace per member" design decision -- a partial unique
-- index (not just application logic) makes it structurally impossible for one auth user to hold
-- two simultaneously-active memberships across different owners.
create unique index if not exists workspace_members_one_active_workspace_per_member
    on workspace_members(member_user_id) where status = 'active';

create index if not exists idx_workspace_members_owner on workspace_members(owner_id);
create index if not exists idx_workspace_members_member on workspace_members(member_user_id);

alter table workspace_members enable row level security;
alter table workspace_members force row level security;

create policy "workspace_members_owner_all" on workspace_members for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "workspace_members_self_select" on workspace_members for select to authenticated
using (member_user_id = auth.uid());
