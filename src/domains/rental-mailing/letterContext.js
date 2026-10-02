// Rentec parity R20 — server-side merge-field resolution for letters.
//
// resolveLetterTemplateContext() walks tenant → lease → unit/property and
// rent charges and returns a plain { fieldKey: value } map for
// renderMessageTemplate(). It NEVER throws: every lookup is guarded, so a
// missing link (no lease, no unit address) yields null fields — which the
// renderer reports as `missing` instead of crashing the composer. The
// composer then requires the owner to type the recipient address by hand.

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

function formatAddress(unit) {
  if (!unit) return null;
  const street = [unit.address_street, unit.address_unit].filter(Boolean).join(" ").trim();
  const cityStateZip = [unit.address_city, [unit.address_state, unit.address_zip].filter(Boolean).join(" ").trim()]
    .filter(Boolean).join(", ").trim();
  const lines = [street, cityStateZip].filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

async function maybeSingle(query) {
  try {
    const { data } = await query.maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

export async function resolveLetterTemplateContext({ supabaseClient, ownerId, tenantId }) {
  const fields = { letter_date: shortDate.format(new Date()) };
  let leaseId = null;
  try {
    const tenant = await maybeSingle(
      supabaseClient.from("rental_tenants")
        .select("id, display_name")
        .eq("owner_id", ownerId)
        .eq("id", tenantId),
    );
    fields.tenant_name = tenant?.display_name || null;

    const memberships = await maybeSingle(
      supabaseClient.from("rental_lease_tenants")
        .select("lease_id")
        .eq("owner_id", ownerId)
        .eq("tenant_id", tenantId)
        .limit(1),
    );
    leaseId = memberships?.lease_id || null;

    if (leaseId) {
      const lease = await maybeSingle(
        supabaseClient.from("rental_leases")
          .select("id, unit_id, monthly_rent_cents, end_date")
          .eq("owner_id", ownerId)
          .eq("id", leaseId),
      );
      if (lease) {
        fields.monthly_rent = lease.monthly_rent_cents == null
          ? null : usd.format(Number(lease.monthly_rent_cents) / 100);
        fields.lease_end_date = formatDateOnly(lease.end_date);
        const unit = await maybeSingle(
          supabaseClient.from("rental_units")
            .select("id, address_street, address_unit, address_city, address_state, address_zip")
            .eq("owner_id", ownerId)
            .eq("id", lease.unit_id),
        );
        fields.tenant_address = formatAddress(unit);
      }
      fields.property_label = await resolvePropertyLabel(supabaseClient, { ownerId, leaseId });

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
    }

    const settings = await maybeSingle(
      supabaseClient.from("rental_email_settings")
        .select("sender_name")
        .eq("owner_id", ownerId),
    );
    fields.owner_name = settings?.sender_name || null;
    // The owner return address is entered per batch in the composer — no
    // workspace-level mailing address exists yet, so the field is null here
    // and the composer fills it (stored as a snapshot on each letter).
    fields.owner_return_address = null;
  } catch (error) {
    console.error("Letter template context resolution failed", {
      tenantId,
      name: error?.name || "Error",
    });
  }
  return { fields, leaseId };
}
