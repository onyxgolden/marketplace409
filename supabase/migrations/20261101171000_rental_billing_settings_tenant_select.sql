-- Tenant portal billing flag was invisible to tenants (Barnhill, 2026-11-01):
-- TenantPortalQueryService reads rental_billing_settings through the tenant's
-- RLS-scoped client, but the table had only an owner_select policy
-- (has_workspace_access), which is false for every pure tenant. So
-- billingEnabled was always false for tenants, the display gate
-- isChargePayableThroughForge failed on its first line for every charge,
-- and the portal showed $0.00 FORGE-payable with every open charge
-- "Managed in Rentec" — even for a linked, cut-over FORGE schedule.
-- The payment-session server gate (service role) was never affected and
-- remains the authoritative gate; this policy only lets a tenant READ
-- their own owner's operational billing flags (billing_enabled,
-- payment_policy, card fee bps) — no secrets live on this table.
-- A tenant of the owner can read the owner's row; tenants of other
-- owners still see nothing.
CREATE POLICY rental_billing_settings_tenant_select
  ON rental_billing_settings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM rental_tenants t
      WHERE t.owner_id = rental_billing_settings.owner_id
        AND t.auth_user_id = auth.uid()
    )
  );
