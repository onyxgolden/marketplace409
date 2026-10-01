-- Rentec-parity R9: owner cash movements (disbursements + contributions).
--
-- Disbursements (owner draws) and contributions (owner pays INTO the operating
-- account) are EQUITY movements, not income or expenses. They deliberately live
-- outside financial_events so they can never leak into income/expense reports:
-- a contribution is never income (the Rentec "Other"-type guarantee is structural
-- here, not a category flag that some report might forget to filter).
--
-- The owner balance domain (src/application/rental/ownerStatements.js) computes
-- the running balance due to each owner as:
--   income (financial_events, kind='income')
--   - expenses (financial_events, kind='expense')
--   - active disbursements
--   + active contributions
-- Voiding flips status to 'voided' and restores the balance; rows are never
-- hard-deleted, preserving the audit trail.

create table if not exists owner_cash_movements (
    id text primary key default gen_random_uuid()::text,

    owner_id text not null,

    -- Null = workspace/portfolio level (an owner draw against the whole
    -- operating account). Set when the movement is tied to one property.
    property_id text,

    kind text not null check (kind in ('disbursement', 'contribution')),

    amount numeric not null check (amount > 0),

    movement_date date not null,

    method text not null default 'check' check (method in ('check', 'ach', 'wire', 'cash', 'other')),

    memo text not null default '',

    status text not null default 'active' check (status in ('active', 'voided')),

    voided_at timestamptz,
    voided_by text,

    created_by text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint owner_cash_movements_void_state_check
        check (
            (status = 'active' and voided_at is null)
            or
            (status = 'voided' and voided_at is not null)
        )
);

create index if not exists idx_owner_cash_movements_owner
    on owner_cash_movements(owner_id);

create index if not exists idx_owner_cash_movements_owner_date
    on owner_cash_movements(owner_id, movement_date desc);

create index if not exists idx_owner_cash_movements_property
    on owner_cash_movements(property_id);

alter table owner_cash_movements enable row level security;
alter table owner_cash_movements force row level security;

drop policy if exists "owner_cash_movements_owner_select" on owner_cash_movements;
create policy "owner_cash_movements_owner_select" on owner_cash_movements for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "owner_cash_movements_owner_insert" on owner_cash_movements;
create policy "owner_cash_movements_owner_insert" on owner_cash_movements for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "owner_cash_movements_owner_update" on owner_cash_movements;
create policy "owner_cash_movements_owner_update" on owner_cash_movements for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "owner_cash_movements_owner_delete" on owner_cash_movements;
create policy "owner_cash_movements_owner_delete" on owner_cash_movements for delete to authenticated
  using (has_workspace_access(owner_id));
