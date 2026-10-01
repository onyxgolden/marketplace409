// Rentec parity R15 — the system notice library.
//
// Notice types mirror Rentec's forms library plus the industry-standard
// notice family: pay-or-quit, late rent notice, lease violation
// (cure-or-quit), move-out reminder (notice to vacate), rent increase, and
// notice to enter. Every template uses the placeholder engine
// (formPlaceholders.js) — see NOTICE_FORM_FIELDS.md for the catalog.
//
// Like R6, system rows are never edited or deleted: the workspace owner
// duplicates one into a custom form to change the wording. The bodies are
// plain-English starting points; notice language and cure/vacate timelines
// vary by state and local law, and the builder UI says so.

export const SYSTEM_FORM_KINDS = ["notice", "form"];

// System-default notice templates. Seeded per workspace by
// ensureSystemCustomForms() (idempotent upsert on (owner_id, system_key));
export const SYSTEM_FORMS = [
  {
    systemKey: "pay_or_quit_notice",
    name: "Pay or quit notice",
    kind: "notice",
    body: [
      "NOTICE TO PAY RENT OR QUIT",
      "",
      "Date: {{today}}",
      "To: {{tenant.name}}",
      "Property: {{property.label}}",
      "{{property.address}}",
      "",
      "You are in default of your lease agreement for failure to pay rent.",
      "",
      "Amount past due: {{balance.due}}",
      "Monthly rent: {{lease.rent}} (due on day {{lease.due_day}} of each month)",
      "",
      "Within the time required by your state and local law after service of",
      "this notice, you must pay the total amount past due in full or vacate",
      "the premises and deliver possession to the undersigned.",
      "",
      "If you fail to pay or vacate within the required time, legal proceedings",
      "may be started to recover possession of the premises, the rent due, and",
      "any other damages allowed by law.",
      "",
      "Sincerely,",
      "{{owner.name}}",
    ].join("\n"),
  },
  {
    systemKey: "late_rent_notice",
    name: "Late rent notice",
    kind: "notice",
    body: [
      "LATE RENT NOTICE",
      "",
      "Date: {{today}}",
      "To: {{tenant.name}}",
      "Property: {{property.label}}",
      "",
      "Our records show your rent payment is past due.",
      "",
      "Amount past due: {{balance.due}}",
      "Monthly rent: {{lease.rent}} (due on day {{lease.due_day}} of each month)",
      "",
      "Please pay the past-due amount immediately to avoid further action,",
      "including a pay-or-quit notice and any late fees provided in your lease.",
      "",
      "If you have already paid, please contact us right away.",
      "",
      "Sincerely,",
      "{{owner.name}}",
    ].join("\n"),
  },
  {
    systemKey: "lease_violation_notice",
    name: "Lease violation notice (cure or quit)",
    kind: "notice",
    body: [
      "NOTICE OF LEASE VIOLATION — CURE OR QUIT",
      "",
      "Date: {{today}}",
      "To: {{tenant.name}}",
      "Property: {{property.label}}",
      "",
      "You are in violation of your lease agreement dated {{lease.start}}",
      "for the following reason:",
      "",
      "Violation: ________",
      "Lease section violated: ________",
      "",
      "Within the time required by your state and local law after service of",
      "this notice, you must correct (\"cure\") the violation described above.",
      "",
      "How to correct the violation: ________",
      "",
      "If you fail to correct the violation within the required time, legal",
      "proceedings may be started to recover possession of the premises.",
      "",
      "Sincerely,",
      "{{owner.name}}",
    ].join("\n"),
  },
  {
    systemKey: "move_out_reminder",
    name: "Move-out reminder (notice to vacate)",
    kind: "notice",
    body: [
      "NOTICE TO VACATE — MOVE-OUT REMINDER",
      "",
      "Date: {{today}}",
      "To: {{tenant.name}}",
      "Property: {{property.label}}",
      "",
      "Your lease ends on {{lease.end}}. This is your reminder that you must",
      "vacate the premises and return all keys no later than that date, unless",
      "a renewal or extension has been signed.",
      "",
      "Please leave the property in clean condition and provide a forwarding",
      "address so your security deposit can be accounted for and returned as",
      "required by your state and local law.",
      "",
      "Sincerely,",
      "{{owner.name}}",
    ].join("\n"),
  },
  {
    systemKey: "rent_increase_notice",
    name: "Rent increase notice",
    kind: "notice",
    body: [
      "NOTICE OF RENT INCREASE",
      "",
      "Date: {{today}}",
      "To: {{tenant.name}}",
      "Property: {{property.label}}",
      "",
      "Your monthly rent will change as follows:",
      "",
      "Current rent: {{lease.rent}}",
      "New rent: $________ per month",
      "Effective date: ________",
      "",
      "All other terms of your lease remain unchanged. Please adjust any",
      "automatic payments to the new amount before the effective date.",
      "",
      "Sincerely,",
      "{{owner.name}}",
    ].join("\n"),
  },
  {
    systemKey: "notice_to_enter",
    name: "Notice to enter (inspection)",
    kind: "notice",
    body: [
      "NOTICE OF INTENT TO ENTER",
      "",
      "Date: {{today}}",
      "To: {{tenant.name}}",
      "Property: {{property.label}}",
      "",
      "We intend to enter the premises on:",
      "",
      "Date and time: ________",
      "Purpose: ________",
      "",
      "Entry will be at a reasonable time and for a lawful purpose, as",
      "required by your state and local law. Please contact us if this time",
      "does not work.",
      "",
      "Sincerely,",
      "{{owner.name}}",
    ].join("\n"),
  },
];

// Idempotent per-workspace seed of the system catalog. Safe to call on every
// list read: the unique (owner_id, system_key) constraint plus
// ignoreDuplicates makes re-runs a no-op, and the insert RLS policy
// (has_workspace_access) covers the authenticated client — no service role.
export async function ensureSystemCustomForms({ supabaseClient, ownerId }) {
  const rows = SYSTEM_FORMS.map((form) => ({
    owner_id: ownerId,
    system_key: form.systemKey,
    is_system: true,
    name: form.name,
    kind: form.kind,
    body: form.body,
  }));
  const { error } = await supabaseClient
    .from("rental_custom_forms")
    .upsert(rows, { onConflict: "owner_id,system_key", ignoreDuplicates: true });
  if (error) throw new Error(`Unable to seed system notice forms: ${error.message}`);
}

// Shared input validation for the create/update routes. System forms are
// never created through the API (is_system is always forced false); a
// duplicate carries the source id separately.
export function validateFormInput(input = {}) {
  const name = String(input.name ?? "").trim();
  const kind = String(input.kind ?? "notice").trim();
  const body = String(input.body ?? "").trim();
  if (!name) return { ok: false, error: "A form name is required." };
  if (name.length > 120) return { ok: false, error: "The form name must be 120 characters or fewer." };
  if (!SYSTEM_FORM_KINDS.includes(kind)) {
    return { ok: false, error: `Kind must be one of: ${SYSTEM_FORM_KINDS.join(", ")}.` };
  }
  if (!body) return { ok: false, error: "The form body is required." };
  if (body.length > 12000) return { ok: false, error: "The form body must be 12,000 characters or fewer." };
  return { ok: true, clean: { name, kind, body } };
}

// Map a DB row to the API/client shape.
export function rowToForm(row) {
  return {
    id: row.id,
    systemKey: row.system_key,
    isSystem: row.is_system,
    name: row.name,
    kind: row.kind,
    body: row.body,
    updatedAt: row.updated_at,
  };
}

export function rowToNoticeLog(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    leaseId: row.lease_id,
    formId: row.form_id,
    formName: row.form_name,
    renderedBody: row.rendered_body,
    createdAt: row.created_at,
  };
}
