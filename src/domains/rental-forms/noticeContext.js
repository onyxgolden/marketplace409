// Rentec parity R15 — server-side placeholder context resolution.
//
// resolveNoticeContext() walks tenant → lease → unit → charges/owner
// settings/custom fields and returns the nested context object the
// placeholder engine (renderNoticeTemplate) consumes:
//
//   { tenant: {name, email, phone},
//     property: {label, address},
//     unit: {label},
//     lease: {start, end, rent, due_day},
//     balance: {due},
//     owner: {name},
//     custom: { <field_key>: formattedValue, ... },
//     today: "Oct 1, 2026" }
//
// It NEVER throws: every lookup is guarded, so a missing link yields null
// fields — which the renderer reports as `missing` instead of crashing the
// preview. This is the context the custom-forms render route and the
// notice builder preview render against.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function formatDateOnly(value) {
  if (!value) return null;
  // Date-only strings ("2026-10-01") parse as UTC midnight; pin to noon so
  // the formatted day never shifts a day back in US timezones.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : shortDate.format(date);
}

function formatAddress(address = {}) {
  const street = String(address.street || "").trim();
  const unit = String(address.unit || "").trim();
  const city = String(address.city || "").trim();
  const state = String(address.state || "").trim().toUpperCase();
  const zip = String(address.zip || "").trim();
  const locality = [city, state].filter(Boolean).join(", ");
  const tail = [locality, zip].filter(Boolean).join(" ");
  return [street, unit, tail].filter(Boolean).join(", ") || null;
}

function humanizePropertyId(propertyId) {
  return String(propertyId || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || null;
}

async function maybeSingle(query) {
  try {
    const { data } = await query.maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

// The formatFieldValue display helper is type-aware (Yes/No, dates); kept
// local to this module so the server context never imports UI code.
function displayCustomValue(fieldType, valueText) {
  if (valueText === null || valueText === undefined || String(valueText).trim() === "") return null;
  const text = String(valueText);
  if (fieldType === "yes_no") return text === "yes" ? "Yes" : "No";
  if (fieldType === "date" && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const formatted = formatDateOnly(text);
    return formatted || text;
  }
  return text;
}

async function customFieldValues({ supabaseClient, ownerId, entity, recordId }) {
  const values = {};
  if (!recordId) return values;
  try {
    const { data: fields } = await supabaseClient
      .from("rental_custom_fields")
      .select("id, field_key, field_type")
      .eq("owner_id", ownerId)
      .eq("entity", entity);
    if (!fields || fields.length === 0) return values;
    const byId = new Map(fields.map((field) => [field.id, field]));
    const { data: rows } = await supabaseClient
      .from("rental_custom_field_values")
      .select("field_id, value_text")
      .eq("owner_id", ownerId)
      .eq("record_id", recordId)
      .in("field_id", fields.map((field) => field.id));
    for (const row of rows || []) {
      const field = byId.get(row.field_id);
      if (!field || !field.field_key) continue;
      const display = displayCustomValue(field.field_type, row.value_text);
      if (display !== null) values[field.field_key] = display;
    }
  } catch {
    // Custom fields are optional context — a lookup failure yields no
    // custom placeholders rather than a failed render.
  }
  return values;
}

export async function resolveNoticeContext({ supabaseClient, ownerId, tenantId, leaseId = null }) {
  const context = {
    tenant: { name: null, email: null, phone: null },
    property: { label: null, address: null },
    unit: { label: null },
    lease: { start: null, end: null, rent: null, due_day: null },
    balance: { due: null },
    owner: { name: null },
    custom: {},
    today: shortDate.format(new Date()),
  };
  try {
    if (tenantId) {
      const tenant = await maybeSingle(
        supabaseClient.from("rental_tenants")
          .select("display_name, email, phone")
          .eq("owner_id", ownerId)
          .eq("id", tenantId),
      );
      if (tenant) {
        context.tenant.name = tenant.display_name || null;
        context.tenant.email = tenant.email || null;
        context.tenant.phone = tenant.phone || null;
      }
    }

    let resolvedLeaseId = leaseId;
    if (!resolvedLeaseId && tenantId) {
      const link = await maybeSingle(
        supabaseClient.from("rental_lease_tenants")
          .select("lease_id")
          .eq("owner_id", ownerId)
          .eq("tenant_id", tenantId)
          .limit(1),
      );
      resolvedLeaseId = link?.lease_id || null;
    }

    if (resolvedLeaseId) {
      const lease = await maybeSingle(
        supabaseClient.from("rental_leases")
          .select("id, property_id, unit_id, start_date, end_date, monthly_rent_cents, rent_due_day")
          .eq("owner_id", ownerId)
          .eq("id", resolvedLeaseId),
      );
      if (lease) {
        context.lease.start = formatDateOnly(lease.start_date);
        context.lease.end = formatDateOnly(lease.end_date);
        context.lease.rent = lease.monthly_rent_cents != null
          ? usd.format(Number(lease.monthly_rent_cents) / 100)
          : null;
        context.lease.due_day = lease.rent_due_day != null ? String(lease.rent_due_day) : null;

        if (lease.unit_id) {
          const unit = await maybeSingle(
            supabaseClient.from("rental_units")
              .select("label, address_street, address_unit, address_city, address_state, address_zip")
              .eq("owner_id", ownerId)
              .eq("id", lease.unit_id),
          );
          if (unit) {
            context.unit.label = unit.label || null;
            context.property.address = formatAddress({
              street: unit.address_street,
              unit: unit.address_unit,
              city: unit.address_city,
              state: unit.address_state,
              zip: unit.address_zip,
            });
          }
        }
        context.property.label =
          context.unit.label || humanizePropertyId(lease.property_id);

        // Balance due: open (unpaid, non-void) rent charges on this lease.
        try {
          const { data: charges } = await supabaseClient.from("rent_charges")
            .select("amount_cents, paid_amount_cents")
            .eq("owner_id", ownerId)
            .eq("lease_id", resolvedLeaseId)
            .not("status", "in", "(paid,void)");
          const open = charges || [];
          const balanceCents = open.reduce(
            (sum, charge) => sum + (Number(charge.amount_cents) - Number(charge.paid_amount_cents || 0)),
            0,
          );
          context.balance.due = usd.format(balanceCents / 100);
        } catch {
          context.balance.due = null;
        }

        // Custom fields: lease values first, tenant values win on key
        // collisions (the tenant's own answer is the more specific one).
        const leaseCustom = await customFieldValues({
          supabaseClient, ownerId, entity: "lease", recordId: resolvedLeaseId,
        });
        const tenantCustom = tenantId
          ? await customFieldValues({ supabaseClient, ownerId, entity: "tenant", recordId: tenantId })
          : {};
        context.custom = { ...leaseCustom, ...tenantCustom };
      }
    } else if (tenantId) {
      // No lease on record: the tenant's own custom fields still populate.
      context.custom = await customFieldValues({ supabaseClient, ownerId, entity: "tenant", recordId: tenantId });
    }

    const settings = await maybeSingle(
      supabaseClient.from("rental_email_settings")
        .select("sender_name")
        .eq("owner_id", ownerId),
    );
    context.owner.name = settings?.sender_name || null;
  } catch (error) {
    console.error("Notice context resolution failed", {
      tenantId,
      leaseId,
      name: error?.name || "Error",
    });
  }
  return context;
}
