// Rentec parity R6 — server-side merge-field resolution.
//
// resolveWorkOrderTemplateContext() walks work order → request → tenant →
// lease → charges/contractor/owner settings and returns a plain
// { fieldKey: value } map for renderMessageTemplate(). It NEVER throws:
// every lookup is guarded, so a missing link (or a table that does not
// exist yet) yields null fields — which the renderer reports as `missing`
// instead of crashing the composer. This is the context the R5 work-order
// message composer's template picker renders against.

import { resolvePropertyLabel } from "@/application/rental/queueOwnerPaymentNotification";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function formatDateOnly(value) {
  if (!value) return null;
  // Date-only strings ("2026-10-01") parse as UTC midnight; pin to noon so
  // the formatted day never shifts a day back in US timezones.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : shortDate.format(date);
}

async function maybeSingle(query) {
  try {
    const { data } = await query.maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

export async function resolveWorkOrderTemplateContext({ supabaseClient, ownerId, workOrderId }) {
  const fields = {};
  try {
    const workOrder = await maybeSingle(
      supabaseClient.from("rental_maintenance_work_orders")
        .select("id, request_id, contractor_id, scope_of_work, scheduled_start")
        .eq("owner_id", ownerId)
        .eq("id", workOrderId),
    );
    if (!workOrder) return fields;

    fields.work_order_scope = workOrder.scope_of_work || null;
    fields.scheduled_date = formatDateOnly(workOrder.scheduled_start);

    if (workOrder.contractor_id) {
      const contractor = await maybeSingle(
        supabaseClient.from("rental_contractors")
          .select("business_name")
          .eq("owner_id", ownerId)
          .eq("id", workOrder.contractor_id),
      );
      fields.contractor_name = contractor?.business_name || null;
    }

    const request = await maybeSingle(
      supabaseClient.from("rental_maintenance_requests")
        .select("id, lease_id, tenant_id, title")
        .eq("owner_id", ownerId)
        .eq("id", workOrder.request_id),
    );
    const leaseId = request?.lease_id || null;
    let tenantId = request?.tenant_id || null;
    if (!tenantId && leaseId) {
      const link = await maybeSingle(
        supabaseClient.from("rental_lease_tenants")
          .select("tenant_id")
          .eq("owner_id", ownerId)
          .eq("lease_id", leaseId)
          .limit(1),
      );
      tenantId = link?.tenant_id || null;
    }
    if (tenantId) {
      const tenant = await maybeSingle(
        supabaseClient.from("rental_tenants")
          .select("display_name")
          .eq("owner_id", ownerId)
          .eq("id", tenantId),
      );
      fields.tenant_name = tenant?.display_name || null;
    }

    if (leaseId) {
      let charges = null;
      try {
        const result = await supabaseClient.from("rent_charges")
          .select("due_date, amount_cents, paid_amount_cents")
          .eq("owner_id", ownerId)
          .eq("lease_id", leaseId)
          .not("status", "in", "(paid,void)")
          .order("due_date", { ascending: true });
        charges = result.data || null;
      } catch {
        charges = null;
      }
      const open = charges || [];
      const balanceCents = open.reduce(
        (sum, charge) => sum + (Number(charge.amount_cents) - Number(charge.paid_amount_cents || 0)),
        0,
      );
      fields.balance_due = usd.format(balanceCents / 100);
      fields.rent_due_date = open.length ? formatDateOnly(open[0].due_date) : null;
      fields.property_label = await resolvePropertyLabel(supabaseClient, { ownerId, leaseId });
    }

    const settings = await maybeSingle(
      supabaseClient.from("rental_email_settings")
        .select("sender_name")
        .eq("owner_id", ownerId),
    );
    fields.owner_name = settings?.sender_name || null;
  } catch (error) {
    console.error("Work-order template context resolution failed", {
      workOrderId,
      name: error?.name || "Error",
    });
  }
  return fields;
}
