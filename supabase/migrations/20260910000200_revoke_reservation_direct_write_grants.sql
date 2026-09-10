-- reservation_guests, reservations, reservation_events, and reservation_inventory_imports are
-- all designed to be SELECT-only via RLS, with every mutation going exclusively through
-- confirm_owner_reservation / import_reservation_inventory_bulk (both SECURITY DEFINER, both
-- already the ONLY write path in practice -- none of these four tables has an INSERT, UPDATE, or
-- DELETE policy at all, so Postgres's row-level security correctly denies any direct mutation
-- attempt regardless of table grants: a command with no applicable policy is denied outright.
-- Confirmed live, locally, against a synthetic authenticated session with full table grants and
-- a self-owned (has_workspace_access-passing) row -- INSERT was still rejected with "new row
-- violates row-level security policy."
--
-- The underlying migrations (20260901000200_create_reservations_and_atomic_confirmation.sql,
-- 20260901000300_add_atomic_reservation_inventory_bulk_import.sql) only ever explicitly
-- `grant select ... to authenticated` for these tables, on the same assumption every other
-- SELECT-only table in this schema was written under: that NOT granting insert/update/delete is
-- enough to withhold them. That assumption is false whenever a table is newly created after this
-- project's default privileges were set to grant everything (arwdDxtm) to authenticated by
-- default -- exactly reservation_calendar_blocks's own sibling migration got right (it explicitly
-- REVOKEs insert/update/delete on the very next line) but these four tables never did, leaving a
-- latent, currently-harmless-only-because-RLS-covers-it privilege mismatch between "what's
-- granted" and "what's intended."
--
-- This migration closes that mismatch directly rather than relying solely on RLS's implicit-deny
-- as the only line of defense -- matching the belt-and-suspenders principle already used
-- elsewhere in this schema (e.g. financial_account_groups explicitly revokes insert/update/delete
-- even though its own RLS policy is already SELECT-only). Purely a grant change: no table,
-- column, policy, or RPC is altered, and no existing row is touched.
revoke insert, update, delete on reservation_guests from authenticated;
revoke insert, update, delete on reservations from authenticated;
revoke insert, update, delete on reservation_events from authenticated;
revoke insert, update, delete on reservation_inventory_imports from authenticated;
