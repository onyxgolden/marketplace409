// Rentec parity R6 — message templates library.
//
// Field syntax: {{field_key}} (whitespace inside the braces is ignored).
// This module is the SINGLE renderer every sender uses: the work-order
// message composer, the template library preview, and any future sender
// (mailing, welcome emails) all call renderMessageTemplate(). The pure
// function is deliberately client-safe so the library UI can preview too.
//
// Render contract (tested in __tests__/messageTemplates.test.js):
//   * known field with a value      -> substituted
//   * known field with null/undefined -> "" and listed in `missing`
//   * unknown {{token}}             -> left VERBATIM and listed in `unknown`
// Leaving unknown tokens verbatim (instead of blanking them) keeps a typo
// visible in the preview instead of silently sending a broken message.

export const TEMPLATE_KINDS = ["email", "text", "mailing"];
export const TEMPLATE_AUDIENCES = ["tenant", "owner"];

// The field catalog. Every key below is a stable contract: templates stored
// in the database reference these keys, so keys are never renamed — only
// added. Documented for Brandy next to the code in MESSAGE_TEMPLATE_FIELDS.md.
export const TEMPLATE_FIELDS = [
  { key: "tenant_name", label: "Tenant name", description: "The tenant's display name." },
  { key: "property_label", label: "Property / unit", description: "Unit label, or the property slug humanized (\"308-paula\" → \"308 Paula\")." },
  { key: "balance_due", label: "Balance due", description: "Total unpaid rent charges, formatted as USD ($1,600.00)." },
  { key: "rent_due_date", label: "Rent due date", description: "Earliest unpaid charge's due date (e.g. Oct 1, 2026)." },
  { key: "owner_name", label: "Owner name", description: "The workspace's sender name from email settings." },
  { key: "work_order_scope", label: "Work order scope", description: "What the work order covers." },
  { key: "contractor_name", label: "Contractor", description: "Assigned contractor's business name." },
  { key: "scheduled_date", label: "Scheduled date", description: "When the work is scheduled (e.g. Oct 2, 2026)." },
  // R20 Mailing Manager fields — resolved per tenant when a letter is
  // composed (see resolveLetterTemplateContext()).
  { key: "tenant_address", label: "Tenant mailing address", description: "The tenant's mailing address from their unit (multi-line); blank when the unit has no address on file." },
  { key: "owner_return_address", label: "Owner return address", description: "The sender return address entered when the letter is composed." },
  { key: "letter_date", label: "Letter date", description: "The date printed on the letter (e.g. Oct 1, 2026)." },
  { key: "monthly_rent", label: "Monthly rent", description: "The lease's monthly rent, formatted as USD ($1,600.00)." },
  { key: "lease_end_date", label: "Lease end date", description: "The lease's end date, if set (e.g. Aug 31, 2027)." },
];

const FIELD_KEYS = new Set(TEMPLATE_FIELDS.map((field) => field.key));
const TOKEN_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function renderMessageTemplate(templateBody, fields = {}) {
  const values = fields ?? {};
  const missing = new Set();
  const unknown = new Set();
  const text = String(templateBody ?? "").replace(TOKEN_PATTERN, (token, key) => {
    if (!FIELD_KEYS.has(key)) {
      unknown.add(key);
      return token; // leave verbatim so a typo stays visible
    }
    const value = values[key];
    if (value === null || value === undefined || value === "") {
      missing.add(key);
      return "";
    }
    return String(value);
  });
  return { text, missing: [...missing], unknown: [...unknown] };
}

// System-default templates. Seeded per workspace by
// ensureSystemMessageTemplates() (idempotent upsert on
// (owner_id, system_key)); never edited or deleted — Brandy duplicates one
// into a custom template to change it. Each template exists in separate
// tenant and owner versions, matching Rentec.
export const SYSTEM_TEMPLATES = [
  {
    systemKey: "rent_reminder_tenant_text",
    name: "Rent reminder",
    kind: "text",
    audience: "tenant",
    subject: null,
    body: "Hi {{tenant_name}}, this is a friendly reminder that your rent payment of {{balance_due}} for {{property_label}} is due {{rent_due_date}}. Please pay online or reply if you have questions. — {{owner_name}}",
  },
  {
    systemKey: "rent_reminder_tenant_email",
    name: "Rent reminder",
    kind: "email",
    audience: "tenant",
    subject: "Rent reminder — {{property_label}}",
    body: "Hi {{tenant_name}},\n\nThis is a friendly reminder that your rent payment of {{balance_due}} for {{property_label}} is due {{rent_due_date}}.\n\nPlease pay through the tenant portal, or reply to this message if you have questions.\n\n— {{owner_name}}",
  },
  {
    systemKey: "work_order_scheduled_tenant_text",
    name: "Work order scheduled",
    kind: "text",
    audience: "tenant",
    subject: null,
    body: "Hi {{tenant_name}}, maintenance has been scheduled for {{property_label}}: {{work_order_scope}}. {{contractor_name}} is expected {{scheduled_date}}. — {{owner_name}}",
  },
  {
    systemKey: "work_order_scheduled_tenant_email",
    name: "Work order scheduled",
    kind: "email",
    audience: "tenant",
    subject: "Maintenance scheduled — {{property_label}}",
    body: "Hi {{tenant_name}},\n\nMaintenance has been scheduled for {{property_label}}:\n\n{{work_order_scope}}\n\n{{contractor_name}} is expected {{scheduled_date}}.\n\n— {{owner_name}}",
  },
  {
    systemKey: "work_order_completed_tenant_text",
    name: "Work order completed",
    kind: "text",
    audience: "tenant",
    subject: null,
    body: "Hi {{tenant_name}}, the maintenance work at {{property_label}} is complete: {{work_order_scope}}. Reply if anything still needs attention. — {{owner_name}}",
  },
  {
    systemKey: "work_order_completed_tenant_email",
    name: "Work order completed",
    kind: "email",
    audience: "tenant",
    subject: "Maintenance complete — {{property_label}}",
    body: "Hi {{tenant_name}},\n\nThe maintenance work at {{property_label}} is complete:\n\n{{work_order_scope}}\n\nReply to this message if anything still needs attention.\n\n— {{owner_name}}",
  },
  {
    systemKey: "owner_maintenance_alert_owner_email",
    name: "Maintenance alert",
    kind: "email",
    audience: "owner",
    subject: "Maintenance update — {{property_label}}",
    body: "{{owner_name}},\n\nA work order was updated for {{property_label}}:\n\n{{work_order_scope}}\n\nTenant: {{tenant_name}}.\n\n— FORGE Rental Manager",
  },
  {
    systemKey: "owner_rent_overdue_owner_text",
    name: "Rent overdue alert",
    kind: "text",
    audience: "owner",
    subject: null,
    body: "{{tenant_name}} ({{property_label}}) has an overdue balance of {{balance_due}}. Rent was due {{rent_due_date}}. — {{owner_name}}",
  },
  {
    systemKey: "welcome_tenant_tenant_email",
    name: "Welcome",
    kind: "email",
    audience: "tenant",
    subject: "Welcome to {{property_label}}",
    body: "Hi {{tenant_name}},\n\nWelcome! Your rent of {{balance_due}} for {{property_label}} is due {{rent_due_date}}.\n\n— {{owner_name}}",
  },
  // R20 Mailing Manager system catalog: the mailed versions of the core
  // notices, kind "mailing". The composer prints them for certified mailing
  // (or sends through a connected provider once Jason approves one).
  {
    systemKey: "late_notice_mailing_tenant",
    name: "Late rent notice (certified mail)",
    kind: "mailing",
    audience: "tenant",
    subject: "Past-due rent — {{property_label}}",
    body: "Dear {{tenant_name}},\n\nThis letter is to notify you that your rent account for {{property_label}} is past due. As of {{letter_date}}, your outstanding balance is {{balance_due}}.\n\nYour monthly rent is {{monthly_rent}}. If payment has already been made, please disregard this notice. Otherwise, please remit payment immediately to avoid further action, including late fees and potential legal proceedings under your lease.\n\nIf you are experiencing financial difficulty, please contact us right away so we can discuss your options.\n\nSincerely,\n{{owner_name}}",
  },
  {
    systemKey: "lease_violation_mailing_tenant",
    name: "Lease violation notice (certified mail)",
    kind: "mailing",
    audience: "tenant",
    subject: "Lease violation — {{property_label}}",
    body: "Dear {{tenant_name}},\n\nThis letter is to notify you of a violation of your lease agreement for {{property_label}}.\n\nYou are required to cure this violation within the time period specified by your lease and applicable law. Failure to do so may result in further action, up to and including termination of your tenancy.\n\nPlease contact us immediately to discuss this matter.\n\nSincerely,\n{{owner_name}}",
  },
  {
    systemKey: "rent_increase_mailing_tenant",
    name: "Rent increase notice (certified mail)",
    kind: "mailing",
    audience: "tenant",
    subject: "Rent increase — {{property_label}}",
    body: "Dear {{tenant_name}},\n\nThis letter is to notify you that the monthly rent for {{property_label}} will change, as described below.\n\nYour current monthly rent is {{monthly_rent}}. Please review your lease for the new amount and the effective date, and contact us with any questions.\n\nThank you for being our tenant.\n\nSincerely,\n{{owner_name}}",
  },
  {
    systemKey: "move_out_mailing_tenant",
    name: "Move-out notice (certified mail)",
    kind: "mailing",
    audience: "tenant",
    subject: "Move-out instructions — {{property_label}}",
    body: "Dear {{tenant_name}},\n\nThis letter confirms the move-out arrangements for {{property_label}}. Your lease ends {{lease_end_date}}.\n\nPlease return all keys and remotes, remove all personal belongings, and leave the unit in clean condition. Your security deposit will be accounted for and any refund issued according to your lease and applicable law.\n\nPlease contact us to schedule a final walkthrough.\n\nSincerely,\n{{owner_name}}",
  },
];

// Idempotent per-workspace seed of the system catalog. Safe to call on every
// list read: the unique (owner_id, system_key) constraint plus
// ignoreDuplicates makes re-runs a no-op, and the insert RLS policy
// (has_workspace_access) covers the authenticated client — no service role.
export async function ensureSystemMessageTemplates({ supabaseClient, ownerId }) {
  const rows = SYSTEM_TEMPLATES.map((template) => ({
    owner_id: ownerId,
    system_key: template.systemKey,
    is_system: true,
    name: template.name,
    kind: template.kind,
    audience: template.audience,
    subject: template.subject,
    body: template.body,
  }));
  const { error } = await supabaseClient
    .from("rental_message_templates")
    .upsert(rows, { onConflict: "owner_id,system_key", ignoreDuplicates: true });
  if (error) throw new Error(`Unable to seed system message templates: ${error.message}`);
}

// Shared input validation for the create/update routes. System templates are
// never created through the API (is_system is always forced false); a
// duplicate carries the source id separately.
export function validateTemplateInput(input = {}) {
  const name = String(input.name ?? "").trim();
  const kind = String(input.kind ?? "").trim();
  const audience = String(input.audience ?? "").trim();
  const subject = input.subject === null || input.subject === undefined ? "" : String(input.subject).trim();
  const body = String(input.body ?? "").trim();
  if (!name) return { ok: false, error: "A template name is required." };
  if (name.length > 120) return { ok: false, error: "The template name must be 120 characters or fewer." };
  if (!TEMPLATE_KINDS.includes(kind)) return { ok: false, error: `Kind must be one of: ${TEMPLATE_KINDS.join(", ")}.` };
  if (!TEMPLATE_AUDIENCES.includes(audience)) return { ok: false, error: `Audience must be one of: ${TEMPLATE_AUDIENCES.join(", ")}.` };
  if (kind === "email" && !subject) return { ok: false, error: "Email templates require a subject." };
  if (subject.length > 200) return { ok: false, error: "The subject must be 200 characters or fewer." };
  if (!body) return { ok: false, error: "The template body is required." };
  if (body.length > 8000) return { ok: false, error: "The template body must be 8,000 characters or fewer." };
  return {
    ok: true,
    clean: {
      name,
      kind,
      audience,
      // Mailing templates keep an optional subject — it prints as the
      // letter's "Re:" line. Text templates carry no subject, so the column
      // stays clean.
      subject: kind === "email" || kind === "mailing" ? subject || null : null,
      body,
    },
  };
}
