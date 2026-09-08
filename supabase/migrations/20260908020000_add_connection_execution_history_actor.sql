-- Stripe Financial Connections audit-evidence prep: connection_execution_history already records
-- WHICH WORKSPACE (owner_id) an import/review/repair ran for, but not WHO actually triggered it --
-- a co-owner and the primary owner are indistinguishable in the existing audit trail once
-- has_workspace_access() (see the migration just before this one) lets both of them act on the
-- same rows. Stripe has warned FORGE it may request compliance evidence after the first
-- authorization sessions; the acting authenticated user needs to be recoverable separately from
-- the workspace the action was performed for.
--
-- Purely additive: one nullable column, no backfill, no rewrite of any existing row, no RLS
-- change (the policies converted in the prior migration already cover this table). Existing rows
-- (all Plaid, all pre-dating this column) simply have actor_user_id null -- callers are not
-- required to start populating it, though new Stripe Financial Connections execution rows will.
alter table connection_execution_history
    add column if not exists actor_user_id text;

create index if not exists
    idx_connection_execution_history_actor
on connection_execution_history(actor_user_id);
