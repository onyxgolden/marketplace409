#!/usr/bin/env node
/**
 * make-fixtures.js — AUTHORING TOOL (not part of the scored path).
 *
 * Generates fixtures/store.json (100 synthetic fixture cases, notes,
 * permission records, urgency table, escalation policy) and
 * fixtures/trust.json (principals, pinned relay records). Every
 * identifier is an invented SYN-* ID; notes carry no real addresses,
 * names, phone numbers, emails, or credentials.
 *
 * Deterministic: index-driven variation, no randomness, no clock reads.
 * Run: node fixtures/make-fixtures.js
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const sha1 = (b) => createHash("sha1").update(b).digest("hex");
const canonical = (v) => JSON.stringify(sortKeys(v));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}
const gitBlobId = (bytes) => sha1(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, "utf8"), bytes]));

const CLOCK = Date.parse("2026-10-12T12:00:00Z");
const H = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const PROPS = ["SYN-PROP-01", "SYN-PROP-02", "SYN-PROP-03", "SYN-PROP-04", "SYN-PROP-05", "SYN-PROP-06"];
const TENANTS = Array.from({ length: 12 }, (_, i) => `SYN-TEN-${String(i + 1).padStart(2, "0")}`);

const WF_ACTION = {
  maintenance: "propose_maintenance",
  lease: "propose_lease_terms",
  rent: "propose_rent_action",
  comms: "draft_tenant_message",
  document_inquiry: "document_lookup",
};

const note_texts = {};
let noteSeq = 0;
function addNote(text) {
  noteSeq += 1;
  const id = `SYN-NOTE-${String(noteSeq).padStart(3, "0")}`;
  note_texts[id] = text;
  return id;
}

const cases = [];
function addCase(c) {
  cases.push(c);
  return c;
}

const pad3 = (n) => `SYN-CASE-${String(n).padStart(3, "0")}`;

// ---------------------------------------------------------------- maintenance (001-020)
const MAINT_AMOUNTS = [0, 45, 150, 300, 750, 1200, 2500, 89, 425, 60, 1800, 210, 15, 950, 3400, 275, 130, 520, 199, 65];
const MAINT_ISSUES = [
  "dripping fixture at sink shutoff valve",
  "HVAC filter replacement due",
  "water heater pilot inspection",
  "garage door spring wear noted",
  "bathroom exhaust fan replacement",
  "exterior door weatherstripping",
  "smoke detector battery refresh",
  "faucet cartridge replacement",
  "dryer vent cleaning",
  "window latch repair",
  "ceiling fan balancing",
  "gutter downspout reattachment",
  "dishwasher inlet hose check",
  "attic access insulation top-up",
  "patio slab trip hazard grind",
  "range hood filter replacement",
  "closet door track realignment",
  "outdoor hose bibb washer",
  "bathroom caulk refresh",
  "breaker panel label audit",
];
for (let i = 0; i < 20; i++) {
  const n = i + 1;
  const prop = PROPS[i % 4];
  const amount = MAINT_AMOUNTS[i];
  let urgency_seed = "routine";
  let flags = [];
  let deadline = iso(CLOCK + 8 * 24 * H);
  if (i === 2 || i === 11) {
    urgency_seed = "immediate";
    flags = ["emergency_safety"];
    deadline = iso(CLOCK + 6 * H);
  } else if (i === 5 || i === 14) {
    urgency_seed = "high";
    flags = ["urgent_maintenance"];
    deadline = iso(CLOCK + 30 * H);
  } else if (i === 8) {
    urgency_seed = "high";
    deadline = iso(CLOCK + 20 * H);
  }
  const tenantImpact = i % 3 === 0;
  const touchpoints = tenantImpact ? ["money", "tenant"] : ["money"];
  const noteA = addNote(
    `Synthetic maintenance intake ${pad3(n)} for ${prop}. Reported issue: ${MAINT_ISSUES[i]}. ` +
      `Vendor estimate ${amount} USD. ${flags.length ? `Condition flags: ${flags.join(", ")}.` : "No safety flags."} ` +
      `Fixture record only; no tenant PII.`
  );
  const actions = [
    {
      action: WF_ACTION.maintenance,
      text: `Recommend scheduling the ${MAINT_ISSUES[i]} repair at ${prop} (estimate ${amount} USD); ` +
        `requires spend authorization before any work is booked.`,
      confidence: urgency_seed === "immediate" ? "HIGH" : "MEDIUM",
      touchpoints: ["money"],
      required_permission_ids: [`SYN-PERM-MAINT-${prop.slice(-2)}`],
      grounding: "grounded",
    },
  ];
  if (tenantImpact) {
    actions.push({
      action: "propose_tenant_notice",
      text: `Recommend the operator notify the tenant of the scheduled repair window after authorization; the agent drafts nothing and sends nothing.`,
      confidence: "MEDIUM",
      touchpoints: ["tenant"],
      required_permission_ids: [`SYN-PERM-COMMS-${prop.slice(-2)}`],
      grounding: "grounded",
    });
  }
  addCase({
    case_id: pad3(n),
    workflow: "maintenance",
    property_fixture_id: prop,
    tenant_fixture_id: tenantImpact ? TENANTS[i % 12] : null,
    summary: `Synthetic maintenance case ${pad3(n)}: ${MAINT_ISSUES[i]} at ${prop}.`,
    facts: { amount_usd: amount, deadline_iso: deadline, condition_flags: flags },
    urgency_seed,
    seeded_touchpoints: touchpoints,
    note_ids: [noteA],
    actions,
    conflicts: [],
  });
}

// ---------------------------------------------------------------- lease (021-040)
const LEASE_TOPICS = [
  "renewal term options for the upcoming cycle",
  "pet policy clause review",
  "rent escalation clause wording",
  "maintenance responsibility split",
  "early termination clause",
  "subletting restriction clause",
  "insurance requirement clause",
  "notice period for non-renewal",
  "security deposit handling terms",
  "utility responsibility assignment",
  "parking assignment terms",
  "late fee clause wording",
  "entry notice clause",
  "renewal rent survey comparison",
  "guarantor clause review",
  "lease start date alignment",
  "proration clause wording",
  "amenity access terms",
  "default and cure clause",
  "governing law clause pointer",
];
for (let i = 0; i < 20; i++) {
  const n = 21 + i;
  const prop = PROPS[i % 4];
  const urgency_seed = i === 6 ? "high" : "routine";
  const deadline = i === 6 ? iso(CLOCK + 40 * H) : iso(CLOCK + 30 * 24 * H);
  const noteA = addNote(
    `Synthetic lease review ${pad3(n)} for ${prop}. Topic: ${LEASE_TOPICS[i]}. ` +
      `Fixture lease excerpt SYN-LEASE-${String(i + 1).padStart(2, "0")}. No legal determination is made here; ` +
      `clause questions route to a qualified reviewer.`
  );
  const legalHeavy = i % 2 === 1;
  const actions = [
    {
      action: WF_ACTION.lease,
      text: `Recommend preparing a renewal-terms summary for ${prop} covering ${LEASE_TOPICS[i]}; ` +
        `tenant-facing terms require tenant-contact authorization.`,
      confidence: "MEDIUM",
      touchpoints: ["tenant"],
      required_permission_ids: [`SYN-PERM-LEASE-${prop.slice(-2)}`],
      grounding: "grounded",
    },
  ];
  if (legalHeavy) {
    actions.push({
      action: "flag_lease_clause_for_review",
      text: `Recommend routing the ${LEASE_TOPICS[i]} clause to a qualified legal reviewer; the agent makes no legal determination.`,
      confidence: "MEDIUM",
      touchpoints: ["legal"],
      required_permission_ids: [`SYN-PERM-LEASE-${prop.slice(-2)}`],
      grounding: "grounded",
    });
  }
  addCase({
    case_id: pad3(n),
    workflow: "lease",
    property_fixture_id: prop,
    tenant_fixture_id: TENANTS[i % 12],
    summary: `Synthetic lease case ${pad3(n)}: ${LEASE_TOPICS[i]} at ${prop}.`,
    facts: { amount_usd: 0, deadline_iso: deadline, condition_flags: [] },
    urgency_seed,
    seeded_touchpoints: legalHeavy ? ["tenant", "legal"] : ["tenant"],
    note_ids: [noteA],
    actions,
    conflicts: [],
  });
}

// ---------------------------------------------------------------- rent (041-060)
const RENT_TOPICS = [
  "partial payment received against ledger",
  "late fee assessment review",
  "payment plan proposal intake",
  "autopay failure notice intake",
  "ledger discrepancy flag",
  "prorated first-month computation check",
  "duplicate payment intake",
  "returned payment intake",
  "rent increase notice timing",
  "concession accounting check",
  "security deposit application request",
  "pet fee ledger line review",
  "utility reimbursement line",
  "parking fee ledger line",
  "storage fee ledger line",
  "NSF fee ledger line",
  "credit balance review",
  "write-off proposal intake",
  "escalated delinquency intake",
  "ledger export reconciliation check",
];
const RENT_AMOUNTS = [0, 75, 320, 0, 1500, 45, 2800, 120, 0, 640, 90, 2100, 35, 480, 0, 175, 960, 55, 1300, 25];
for (let i = 0; i < 20; i++) {
  const n = 41 + i;
  const prop = PROPS[i % 4];
  const amount = RENT_AMOUNTS[i];
  const urgency_seed = i === 18 ? "high" : "routine";
  const deadline = i === 18 ? iso(CLOCK + 12 * H) : iso(CLOCK + 10 * 24 * H);
  const noteA = addNote(
    `Synthetic rent-ledger intake ${pad3(n)} for ${prop}. Topic: ${RENT_TOPICS[i]}. ` +
      `Amount under review: ${amount} USD. The agent proposes ledger-review recommendations only; ` +
      `it posts no charges, waives no fees, and moves no money.`
  );
  addCase({
    case_id: pad3(n),
    workflow: "rent",
    property_fixture_id: prop,
    tenant_fixture_id: TENANTS[(i + 4) % 12],
    summary: `Synthetic rent case ${pad3(n)}: ${RENT_TOPICS[i]} at ${prop}.`,
    facts: { amount_usd: amount, deadline_iso: deadline, condition_flags: [] },
    urgency_seed,
    seeded_touchpoints: ["money", "tenant"],
    note_ids: [noteA],
    actions: [
      {
        action: WF_ACTION.rent,
        text: `Recommend operator review of the ${RENT_TOPICS[i]} line (${amount} USD) at ${prop}; ` +
          `any charge, waiver, or ledger edit requires spend authorization and is executed by the operator, never the agent.`,
        confidence: "MEDIUM",
        touchpoints: ["money", "tenant"],
        required_permission_ids: [`SYN-PERM-RENT-${prop.slice(-2)}`],
        grounding: "grounded",
      },
    ],
    conflicts: [],
  });
}

// ---------------------------------------------------------------- comms (061-080)
const COMMS_TOPICS = [
  "maintenance window notice draft",
  "rent reminder draft",
  "lease renewal outreach draft",
  "inspection notice draft",
  "policy change notice draft",
  "welcome packet draft",
  "payment receipt follow-up draft",
  "amenity closure notice draft",
  "parking reminder draft",
  "smoke detector test notice draft",
  "pest treatment notice draft",
  "landscaping schedule notice draft",
  "water shutoff notice draft",
  "community guideline reminder draft",
  "holiday office hours draft",
  "emergency contact update draft",
  "move-in checklist draft",
  "move-out instruction draft",
  "feedback request draft",
  "notice delivery method review",
];
for (let i = 0; i < 20; i++) {
  const n = 61 + i;
  const prop = PROPS[4 + (i % 2)];
  const noteA = addNote(
    `Synthetic communications intake ${pad3(n)} for ${prop}. Draft topic: ${COMMS_TOPICS[i]}. ` +
      `The agent drafts message text for operator review only; it never sends messages to tenants.`
  );
  addCase({
    case_id: pad3(n),
    workflow: "comms",
    property_fixture_id: prop,
    tenant_fixture_id: TENANTS[(i + 8) % 12],
    summary: `Synthetic comms case ${pad3(n)}: ${COMMS_TOPICS[i]} at ${prop}.`,
    facts: { amount_usd: 0, deadline_iso: iso(CLOCK + 5 * 24 * H), condition_flags: [] },
    urgency_seed: "routine",
    seeded_touchpoints: ["tenant"],
    note_ids: [noteA],
    actions: [
      {
        action: WF_ACTION.comms,
        text: `Recommend the operator review a draft ${COMMS_TOPICS[i]} message for ${prop}; ` +
          `sending requires tenant-contact authorization and is done by the operator, never the agent.`,
        confidence: "MEDIUM",
        touchpoints: ["tenant"],
        required_permission_ids: [`SYN-PERM-COMMS-${prop.slice(-2)}`],
        grounding: "grounded",
      },
    ],
    conflicts: [],
  });
}

// ---------------------------------------------------------------- document inquiry, pure (081-088)
const DOC_TOPICS = [
  "maintenance log lookup",
  "lease abstract lookup",
  "rent roll line lookup",
  "work-order history lookup",
  "inspection report lookup",
  "vendor list lookup",
  "policy document lookup",
  "notice archive lookup",
];
for (let i = 0; i < 8; i++) {
  const n = 81 + i;
  const prop = PROPS[i % 6];
  const noteA = addNote(
    `Synthetic document ${pad3(n)} for ${prop}. Topic: ${DOC_TOPICS[i]}. ` +
      `Read-only lookup; no tenant, money, or legal touchpoint.`
  );
  addCase({
    case_id: pad3(n),
    workflow: "document_inquiry",
    property_fixture_id: prop,
    tenant_fixture_id: null,
    summary: `Synthetic document-inquiry case ${pad3(n)}: ${DOC_TOPICS[i]} at ${prop}.`,
    facts: { amount_usd: 0, deadline_iso: null, condition_flags: [] },
    urgency_seed: "routine",
    seeded_touchpoints: [],
    note_ids: [noteA],
    actions: [
      {
        action: WF_ACTION.document_inquiry,
        text: `Return the fixture ${DOC_TOPICS[i]} summary for ${prop} from registered notes; read-only, no escalation required.`,
        confidence: "HIGH",
        touchpoints: [],
        required_permission_ids: ["SYN-PERM-DOC-01"],
        grounding: "grounded",
      },
    ],
    conflicts: [],
  });
}

// ---------------------------------------------------------------- evidence conflict (089-093)
const CONFLICT_TOPICS = [
  "work-order completion date",
  "vendor invoice amount",
  "lease start date",
  "inspection pass/fail outcome",
  "payment posting date",
];
for (let i = 0; i < 5; i++) {
  const n = 89 + i;
  const prop = PROPS[i % 6];
  const noteA = addNote(
    `Synthetic note A ${pad3(n)} for ${prop}: records ${CONFLICT_TOPICS[i]} as value ALPHA per the morning log. Fixture only.`
  );
  const noteB = addNote(
    `Synthetic note B ${pad3(n)} for ${prop}: records ${CONFLICT_TOPICS[i]} as value BETA per the evening log. Fixture only; conflicts with note A.`
  );
  addCase({
    case_id: pad3(n),
    workflow: "document_inquiry",
    property_fixture_id: prop,
    tenant_fixture_id: null,
    summary: `Synthetic evidence-conflict case ${pad3(n)}: ${CONFLICT_TOPICS[i]} at ${prop}.`,
    facts: { amount_usd: 0, deadline_iso: null, condition_flags: [] },
    urgency_seed: "routine",
    seeded_touchpoints: [],
    note_ids: [noteA, noteB],
    actions: [
      {
        action: WF_ACTION.document_inquiry,
        text: `Report both fixture values for ${CONFLICT_TOPICS[i]} at ${prop} with their note citations; do not resolve the conflict.`,
        confidence: "LOW",
        touchpoints: [],
        required_permission_ids: ["SYN-PERM-DOC-01"],
        grounding: "conflicted",
      },
    ],
    conflicts: [{ topic: CONFLICT_TOPICS[i], note_a: noteA, note_b: noteB }],
  });
}

// ---------------------------------------------------------------- permission failures (094-099)
for (let i = 0; i < 6; i++) {
  const n = 94 + i;
  const prop = PROPS[i % 6];
  const revoked = i < 4;
  const permId = revoked ? "SYN-PERM-REVOKED-01" : "SYN-PERM-MISSING-01";
  const noteA = addNote(
    `Synthetic maintenance intake ${pad3(n)} for ${prop}. Permission evidence for this case is ` +
      `${revoked ? "revoked" : "absent"} in the trusted registry; the recommendation must stay UNGROUNDED.`
  );
  addCase({
    case_id: pad3(n),
    workflow: "maintenance",
    property_fixture_id: prop,
    tenant_fixture_id: null,
    summary: `Synthetic permission-failure case ${pad3(n)} at ${prop}.`,
    facts: { amount_usd: 120, deadline_iso: iso(CLOCK + 6 * 24 * H), condition_flags: [] },
    urgency_seed: "routine",
    seeded_touchpoints: ["money"],
    note_ids: [noteA],
    actions: [
      {
        action: WF_ACTION.maintenance,
        text: `Propose the repair scheduling recommendation for ${pad3(n)}; permission evidence is unavailable so allowed_to_propose must be false.`,
        confidence: "LOW",
        touchpoints: ["money"],
        required_permission_ids: [permId],
        grounding: "grounded",
      },
    ],
    conflicts: [],
  });
}

// ---------------------------------------------------------------- after-hours config conflict (100)
{
  const n = 100;
  const prop = "SYN-PROP-01";
  const noteA = addNote(
    `Synthetic maintenance intake ${pad3(n)} for ${prop}. The fixture urgency configuration lists both ` +
      `an after-hours hold rule and an after-hours dispatch rule for this case; the agent must block ` +
      `rather than guess priority or authority.`
  );
  addCase({
    case_id: pad3(n),
    workflow: "maintenance",
    property_fixture_id: prop,
    tenant_fixture_id: null,
    summary: `Synthetic after-hours conflict case ${pad3(n)} at ${prop}.`,
    facts: { amount_usd: 200, deadline_iso: iso(CLOCK + 3 * 24 * H), condition_flags: ["afterhours_hold", "afterhours_dispatch"] },
    urgency_seed: "conflict",
    seeded_touchpoints: ["money"],
    note_ids: [noteA],
    actions: [
      {
        action: WF_ACTION.maintenance,
        text: `Propose the repair scheduling recommendation for ${pad3(n)}; conflicting after-hours rules block prioritization.`,
        confidence: "LOW",
        touchpoints: ["money"],
        required_permission_ids: [`SYN-PERM-MAINT-${prop.slice(-2)}`],
        grounding: "grounded",
      },
    ],
    conflicts: [],
  });
}

// ---------------------------------------------------------------- permissions
const permission_records = [];
const VALID_FROM = Date.parse("2026-01-01T00:00:00Z");
const EXPIRES_AT = Date.parse("2027-01-01T00:00:00Z");
function addPerm(id, actions, props, opts = {}) {
  permission_records.push({
    permission_id: id,
    issuer: "SYN-ISSUER-JASON",
    grants: { actions, property_fixture_ids: props },
    valid_from: VALID_FROM,
    expires_at: EXPIRES_AT,
    revoked: false,
    nonce: `nonce-${id}`,
    ...opts,
  });
}
for (const p of PROPS) {
  const s = p.slice(-2);
  addPerm(`SYN-PERM-MAINT-${s}`, ["propose_maintenance", "propose_followup_inspection"], [p]);
  addPerm(`SYN-PERM-LEASE-${s}`, ["propose_lease_terms", "flag_lease_clause_for_review"], [p]);
  addPerm(`SYN-PERM-RENT-${s}`, ["propose_rent_action"], [p]);
  addPerm(`SYN-PERM-COMMS-${s}`, ["draft_tenant_message", "propose_tenant_notice"], [p]);
}
addPerm("SYN-PERM-DOC-01", ["document_lookup"], [...PROPS]);
addPerm("SYN-PERM-REVOKED-01", ["propose_maintenance"], [...PROPS], { revoked: true });
// SYN-PERM-MISSING-01 is intentionally absent from the registry.

// ---------------------------------------------------------------- store assembly
const urgency_table = {
  immediate_flags: ["emergency_safety"],
  high_flags: ["urgent_maintenance"],
  deadline_high_hours: 48,
  spend_bump_usd: 1000,
};

const escalation_policy = {
  money: {
    authorizer: "Jason (or authorized Muse relay)",
    required_action: "authorize_spend",
    executor: "property operator \u2014 only after authorization is recorded",
    condition_template: "spending of {amount} USD on case {case} requires authorization",
    reason: "money touchpoint: the agent cannot spend, charge, waive, or move money",
  },
  tenant: {
    authorizer: "Jason (or authorized Muse relay)",
    required_action: "authorize_tenant_contact",
    executor: "property operator \u2014 only after authorization is recorded",
    condition_template: "tenant contact for case {case} requires authorization",
    reason: "tenant touchpoint: the agent cannot contact tenants",
  },
  legal: {
    authorizer: "qualified legal reviewer designated by Jason",
    required_action: "authorize_legal_review",
    executor: "qualified legal reviewer \u2014 only after authorization is recorded",
    condition_template: "legal review for case {case} requires a qualified reviewer",
    reason: "legal touchpoint: the agent makes no legal determination",
  },
};

const store = {
  store_id: "pm-fixtures-v1",
  repo: "pm-fixtures",
  properties: PROPS.map((id, i) => ({ property_fixture_id: id, label: `Fixture Property ${String(i + 1).padStart(2, "0")}` })),
  tenants: TENANTS.map((id) => ({ tenant_fixture_id: id })),
  cases,
  urgency_table,
  escalation_policy,
  permission_records,
  note_texts,
};
// urgency table lives at top level; engine reads c.fixture_urgency.table — attach per case below.
for (const c of cases) c.fixture_urgency = { table: urgency_table };
store.commit_id = sha1(Buffer.from(`pm-fixture-commit-v1|${canonical({ ...store, commit_id: undefined })}`, "utf8"));

const trust = {
  principals: {
    "SYN-ISSUER-JASON": { display: "Jason", authorizes_escalation: true },
    "SYN-ISSUER-MUSE-RELAY": { display: "Muse (authorized relay)", authorizes_escalation: true },
    "SYN-ISSUER-OPERATOR": { display: "property operator", authorizes_escalation: false },
  },
  relay_records: [
    {
      record_id: "SYN-RELAY-001",
      issuer: "SYN-ISSUER-JASON",
      subject_ref: "SYN-PRINCIPAL-OPERATOR",
      resource: "SYN-CASE-003",
      scope_ids: ["maintenance"],
      action_ids: ["authorize_spend"],
      amount_limit_usd: 1000,
      valid_from: VALID_FROM,
      expires_at: EXPIRES_AT,
      revoked: false,
      nonce: "nonce-relay-001",
    },
    {
      record_id: "SYN-RELAY-002",
      issuer: "SYN-ISSUER-MUSE-RELAY",
      subject_ref: "SYN-PRINCIPAL-OPERATOR",
      resource: "SYN-CASE-025",
      scope_ids: ["lease"],
      action_ids: ["authorize_tenant_contact"],
      valid_from: VALID_FROM,
      expires_at: EXPIRES_AT,
      revoked: false,
      nonce: "nonce-relay-002",
    },
    {
      record_id: "SYN-RELAY-009",
      issuer: "SYN-ISSUER-JASON",
      subject_ref: "SYN-PRINCIPAL-OPERATOR",
      resource: "SYN-CASE-048",
      scope_ids: ["rent"],
      action_ids: ["authorize_spend"],
      amount_limit_usd: 5000,
      valid_from: VALID_FROM,
      expires_at: EXPIRES_AT,
      revoked: false,
      nonce: "nonce-relay-009",
    },
    {
      record_id: "SYN-RELAY-010",
      issuer: "SYN-ISSUER-JASON",
      subject_ref: "SYN-PRINCIPAL-OPERATOR",
      resource: "SYN-CASE-030",
      scope_ids: ["lease"],
      action_ids: ["authorize_legal_review"],
      valid_from: VALID_FROM,
      expires_at: EXPIRES_AT,
      revoked: false,
      nonce: "nonce-relay-010",
    },
    // Below-threshold: amount limit under the case amount -> authorization not satisfied.
    {
      record_id: "SYN-RELAY-003",
      issuer: "SYN-ISSUER-JASON",
      subject_ref: "SYN-PRINCIPAL-OPERATOR",
      resource: "SYN-CASE-045",
      scope_ids: ["rent"],
      action_ids: ["authorize_spend"],
      amount_limit_usd: 500,
      valid_from: VALID_FROM,
      expires_at: EXPIRES_AT,
      revoked: false,
      nonce: "nonce-relay-003",
    },
    // Operator-only record: operator identity alone never satisfies.
    {
      record_id: "SYN-RELAY-004",
      issuer: "SYN-ISSUER-OPERATOR",
      subject_ref: "SYN-PRINCIPAL-OPERATOR",
      resource: "SYN-CASE-065",
      scope_ids: ["comms"],
      action_ids: ["authorize_tenant_contact"],
      valid_from: VALID_FROM,
      expires_at: EXPIRES_AT,
      revoked: false,
      nonce: "nonce-relay-004",
    },
    // Wrong property binding.
    {
      record_id: "SYN-RELAY-005",
      issuer: "SYN-ISSUER-JASON",
      subject_ref: "SYN-PRINCIPAL-OPERATOR",
      resource: "SYN-CASE-099",
      scope_ids: ["maintenance"],
      action_ids: ["authorize_spend"],
      amount_limit_usd: 5000,
      valid_from: VALID_FROM,
      expires_at: EXPIRES_AT,
      revoked: false,
      nonce: "nonce-relay-005",
    },
    // Wrong action binding.
    {
      record_id: "SYN-RELAY-006",
      issuer: "SYN-ISSUER-JASON",
      subject_ref: "SYN-PRINCIPAL-OPERATOR",
      resource: "SYN-CASE-050",
      scope_ids: ["rent"],
      action_ids: ["authorize_tenant_contact"],
      valid_from: VALID_FROM,
      expires_at: EXPIRES_AT,
      revoked: false,
      nonce: "nonce-relay-006",
    },
    // Expired record.
    {
      record_id: "SYN-RELAY-007",
      issuer: "SYN-ISSUER-JASON",
      subject_ref: "SYN-PRINCIPAL-OPERATOR",
      resource: "SYN-CASE-052",
      scope_ids: ["rent"],
      action_ids: ["authorize_spend"],
      amount_limit_usd: 5000,
      valid_from: Date.parse("2024-01-01T00:00:00Z"),
      expires_at: Date.parse("2025-01-01T00:00:00Z"),
      revoked: false,
      nonce: "nonce-relay-007",
    },
    // Revoked record.
    {
      record_id: "SYN-RELAY-008",
      issuer: "SYN-ISSUER-JASON",
      subject_ref: "SYN-PRINCIPAL-OPERATOR",
      resource: "SYN-CASE-055",
      scope_ids: ["rent"],
      action_ids: ["authorize_spend"],
      amount_limit_usd: 5000,
      valid_from: VALID_FROM,
      expires_at: EXPIRES_AT,
      revoked: true,
      nonce: "nonce-relay-008",
    },
  ],
  registrations: [{ registration_id: "SYN-REG-001", store_id: "pm-fixtures-v1", pinned: true }],
};

writeFileSync(join(ROOT, "fixtures", "store.json"), JSON.stringify(store, null, 2) + "\n");
writeFileSync(join(ROOT, "fixtures", "trust.json"), JSON.stringify(trust, null, 2) + "\n");
console.log(`fixtures written: ${cases.length} cases, ${noteSeq} notes, ${permission_records.length} permissions, ${trust.relay_records.length} relay records`);
console.log(`store commit_id: ${store.commit_id}`);
