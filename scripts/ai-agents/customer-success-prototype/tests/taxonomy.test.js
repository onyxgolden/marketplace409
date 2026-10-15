/**
 * taxonomy.test.js — category precedence, secondary categories,
 * unknown tags, priority rules.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { classifyTicket } from "../src/taxonomy.js";

function ticket(overrides) {
  return { issue_tags: ["TECHNICAL"], impact: "NONE", sentiment_signal: "UNKNOWN", ...overrides };
}

test("single primary tag resolves to that category", () => {
  const c = classifyTicket(ticket({ issue_tags: ["BILLING"] }));
  assert.equal(c.category, "BILLING");
  assert.deepEqual(c.secondary_categories, []);
});

test("precedence: ACCOUNT_CLOSURE beats BILLING and TECHNICAL", () => {
  const c = classifyTicket(ticket({ issue_tags: ["BILLING", "TECHNICAL", "ACCOUNT_CLOSURE"] }));
  assert.equal(c.category, "ACCOUNT_CLOSURE");
  assert.deepEqual(c.secondary_categories, ["BILLING", "TECHNICAL"]);
});

test("precedence: BILLING beats TECHNICAL and FEATURE_REQUEST", () => {
  const c = classifyTicket(ticket({ issue_tags: ["FEATURE_REQUEST", "TECHNICAL", "BILLING"] }));
  assert.equal(c.category, "BILLING");
  assert.deepEqual(c.secondary_categories, ["FEATURE_REQUEST", "TECHNICAL"]);
});

test("a non-primary recognized tag is a secondary category even alone", () => {
  const c = classifyTicket(ticket({ issue_tags: ["GENERAL_INQUIRY"] }));
  assert.equal(c.category, "OTHER");
  assert.deepEqual(c.secondary_categories, ["GENERAL_INQUIRY"]);
});

test("a losing primary tag is retained as secondary, not dropped", () => {
  const c = classifyTicket(ticket({ issue_tags: ["BILLING", "TECHNICAL"] }));
  assert.equal(c.category, "BILLING");
  assert.deepEqual(c.secondary_categories, ["TECHNICAL"]);
});

test("unrecognized tag is named unknown_tags, never guessed into a category", () => {
  const c = classifyTicket(ticket({ issue_tags: ["SOMETHING_NEW"] }));
  assert.equal(c.category, "OTHER");
  assert.deepEqual(c.unknown_tags, ["SOMETHING_NEW"]);
  assert.deepEqual(c.secondary_categories, []);
});

test("priority: TECHNICAL + OUTAGE is HIGH", () => {
  assert.equal(classifyTicket(ticket({ issue_tags: ["TECHNICAL"], impact: "OUTAGE" })).priority, "HIGH");
});

test("priority: TECHNICAL without OUTAGE is NORMAL, not HIGH", () => {
  assert.equal(classifyTicket(ticket({ issue_tags: ["TECHNICAL"], impact: "DEGRADED" })).priority, "NORMAL");
});

test("priority: ACCOUNT_CLOSURE is MEDIUM regardless of sentiment", () => {
  assert.equal(classifyTicket(ticket({ issue_tags: ["ACCOUNT_CLOSURE"], sentiment_signal: "POSITIVE" })).priority, "MEDIUM");
});

test("priority: BILLING + NEGATIVE sentiment is MEDIUM", () => {
  assert.equal(classifyTicket(ticket({ issue_tags: ["BILLING"], sentiment_signal: "NEGATIVE" })).priority, "MEDIUM");
});

test("priority: BILLING + non-NEGATIVE sentiment is NORMAL, not MEDIUM", () => {
  assert.equal(classifyTicket(ticket({ issue_tags: ["BILLING"], sentiment_signal: "POSITIVE" })).priority, "NORMAL");
  assert.equal(classifyTicket(ticket({ issue_tags: ["BILLING"], sentiment_signal: "UNKNOWN" })).priority, "NORMAL");
});

test("priority: FEATURE_REQUEST-only is LOW", () => {
  assert.equal(classifyTicket(ticket({ issue_tags: ["FEATURE_REQUEST"] })).priority, "LOW");
});

test("priority: OTHER is NORMAL", () => {
  assert.equal(classifyTicket(ticket({ issue_tags: ["GENERAL_INQUIRY"] })).priority, "NORMAL");
});

test("sentiment is read verbatim from the structured field, never inferred", () => {
  const c = classifyTicket(ticket({ issue_tags: ["BILLING"], sentiment_signal: "UNKNOWN" }));
  // BILLING+UNKNOWN must NOT be treated as NEGATIVE just because the
  // ticket "sounds" urgent — there is no text here to infer from at all,
  // which is the point: the classifier never looks at free text.
  assert.equal(c.priority, "NORMAL");
});
