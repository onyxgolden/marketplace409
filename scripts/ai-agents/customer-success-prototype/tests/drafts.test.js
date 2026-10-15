/**
 * drafts.test.js — two fixed-template draft variants, both labeled
 * DRAFT — NOT SENT, never echoing raw ticket text, never implying a
 * completed action; Jason-authority routing flag on the right categories.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildDrafts, authorityRequired, DRAFT_LABEL } from "../src/drafts.js";
import { classifyTicket } from "../src/taxonomy.js";

test("buildDrafts returns exactly two variants", () => {
  const c = classifyTicket({ issue_tags: ["TECHNICAL"], impact: "NONE", sentiment_signal: "UNKNOWN" });
  const drafts = buildDrafts("t-1", c);
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts.map((d) => d.variant).sort(), ["acknowledgment", "clarification"]);
});

test("every draft is labeled DRAFT — NOT SENT", () => {
  const c = classifyTicket({ issue_tags: ["BILLING"], impact: "NONE", sentiment_signal: "UNKNOWN" });
  for (const d of buildDrafts("t-2", c)) {
    assert.equal(d.label, DRAFT_LABEL);
    assert.ok(d.text.includes(DRAFT_LABEL));
  }
});

test("draft text contains no raw-looking injected phrases — only the fixed template and the classified label", () => {
  const c = classifyTicket({ issue_tags: ["TECHNICAL"], impact: "OUTAGE", sentiment_signal: "UNKNOWN" });
  const drafts = buildDrafts("t-3", c);
  for (const d of drafts) {
    assert.ok(!/\$\d/.test(d.text), "no dollar amounts");
    assert.ok(!/guarantee/i.test(d.text), "no guarantees");
    assert.ok(/no account action has been taken/i.test(d.text), "explicitly states no action taken");
  }
});

test("ACCOUNT_CLOSURE requires Jason authority, triggers no operational act", () => {
  const c = classifyTicket({ issue_tags: ["ACCOUNT_CLOSURE"], impact: "NONE", sentiment_signal: "UNKNOWN" });
  assert.equal(authorityRequired(c), true);
  const drafts = buildDrafts("t-4", c);
  for (const d of drafts) {
    assert.equal(d.routing_flags.length, 1);
    assert.equal(d.routing_flags[0].code, "JASON_AUTHORITY_REQUIRED");
    assert.match(d.routing_flags[0].reason, /takes no action/);
  }
});

test("REFUND_REQUEST as a secondary category also requires Jason authority", () => {
  const c = classifyTicket({ issue_tags: ["GENERAL_INQUIRY", "REFUND_REQUEST"], impact: "NONE", sentiment_signal: "UNKNOWN" });
  assert.equal(authorityRequired(c), true);
});

test("a plain TECHNICAL ticket requires no authority flag", () => {
  const c = classifyTicket({ issue_tags: ["TECHNICAL"], impact: "NONE", sentiment_signal: "UNKNOWN" });
  assert.equal(authorityRequired(c), false);
  for (const d of buildDrafts("t-5", c)) assert.equal(d.routing_flags.length, 0);
});

test("category label in the draft reflects the classified category, not a raw tag string", () => {
  const c = classifyTicket({ issue_tags: ["FEATURE_REQUEST"], impact: "NONE", sentiment_signal: "UNKNOWN" });
  const [ack] = buildDrafts("t-6", c);
  assert.match(ack.text, /feature request/);
  assert.ok(!ack.text.includes("FEATURE_REQUEST"), "uses the human label, not the raw enum constant");
});
