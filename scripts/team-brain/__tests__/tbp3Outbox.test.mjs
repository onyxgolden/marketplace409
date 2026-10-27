// Team Brain slice 3 — coordination outbox + exporter acceptance tests.
// Pure outbox: fixed entries + injected `now`, no I/O, no clock, no
// network, and no send adapter anywhere in the module.

import { describe, expect, it } from "vitest";
import * as outbox from "../orchestrator/outbox.mjs";
import {
  canonicalPayloadHash,
  claimOutbox,
  enqueueOutbox,
  recordDelivery,
} from "../orchestrator/outbox.mjs";
import { exportReceipt, exportStatus } from "../orchestrator/exporters.mjs";
import { createTask } from "../orchestrator/controller.mjs";

const NOW = "2026-10-27T12:00:00Z";
const T0 = "2026-10-27T10:00:00Z";

function entry(id, extra = {}) {
  return {
    operationId: id,
    targetRepo: "onyxgolden/forge-ai-drop",
    targetPath: "results/chatgpt/note.md",
    expectedPriorBlob: "aaaa",
    payload: { text: "hello" },
    createdAt: T0,
    ...extra,
  };
}
function claimed(id, owner = "a1") {
  const e = enqueueOutbox([], entry(id));
  const c = claimOutbox({ entries: e.entries, operationId: id, owner, now: NOW });
  return { entries: c.entries, lease: c.lease };
}

describe("outbox dedup and allowlist", () => {
  it("same operationId + payload dedups to one entry", () => {
    const first = enqueueOutbox([], entry("op1"));
    const second = enqueueOutbox(first.entries, entry("op1"));
    expect(second.deduped).toBe(true);
    expect(second.entries).toHaveLength(1);
    expect(second.entry.operationId).toBe("op1");
  });

  it("same operationId + different payload is CONFLICTING_REPLAY", () => {
    const first = enqueueOutbox([], entry("op1"));
    expect(() =>
      enqueueOutbox(first.entries, entry("op1", { payload: { text: "different" } })),
    ).toThrowError(/different payload/);
  });

  it("disallowed paths are refused: traversal, absolute, off-allowlist", () => {
    expect(() => enqueueOutbox([], entry("op1", { targetPath: "../secret.md" }))).toThrowError(/not repo-relative/);
    expect(() => enqueueOutbox([], entry("op1", { targetPath: "/etc/passwd" }))).toThrowError(/not repo-relative/);
    expect(() => enqueueOutbox([], entry("op1", { targetPath: "src/app.js" }))).toThrowError(/outside the allowlist/);
  });

  it("payload hash is SHA-256 of the canonical payload", () => {
    const first = enqueueOutbox([], entry("op1"));
    expect(first.entry.payloadHash).toBe(canonicalPayloadHash({ text: "hello" }));
    expect(first.entry.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("no send adapter exists in the outbox module", () => {
    expect(outbox.send).toBeUndefined();
    expect(typeof outbox.enqueueOutbox).toBe("function");
    expect(typeof outbox.recordDelivery).toBe("function");
  });
});

describe("outbox claims and delivery", () => {
  it("claim leases generation 1; a live lease held by another refuses LEASE_HELD", () => {
    const c = claimed("op1", "a1");
    expect(c.lease.generation).toBe(1);
    expect(() => claimOutbox({ entries: c.entries, operationId: "op1", owner: "a2", now: NOW })).toThrowError(
      /leased to a1/,
    );
  });

  it("expired lease is reclaimable at a bumped generation", () => {
    const c = claimed("op1", "a1");
    const later = new Date(Date.parse(NOW) + 16 * 60 * 1000).toISOString();
    const r = claimOutbox({ entries: c.entries, operationId: "op1", owner: "a2", now: later });
    expect(r.lease.generation).toBe(2);
    expect(r.lease.owner).toBe("a2");
    expect(r.alreadyClaimed).toBe(false);
  });

  it("happy-path delivery records the readback receipt and clears the lease", () => {
    const c = claimed("op1", "a1");
    const r = recordDelivery({
      entries: c.entries, operationId: "op1", owner: "a1", generation: 1,
      gitResponse: { repo: "onyxgolden/forge-ai-drop", priorBlob: "aaaa", newBlob: "bbbb", head: "c0ffee", path: "results/chatgpt/note.md" },
      now: NOW,
    });
    expect(r.receipt.newBlob).toBe("bbbb");
    expect(r.receipt.head).toBe("c0ffee");
    expect(r.entry.state).toBe("DELIVERED");
    expect(r.entry.lease).toBeNull();
  });

  it("divergent file: prior blob mismatch is CAS_CONFLICT, entry stays CLAIMED", () => {
    const c = claimed("op1", "a1");
    const r = recordDelivery({
      entries: c.entries, operationId: "op1", owner: "a1", generation: 1,
      gitResponse: { repo: "onyxgolden/forge-ai-drop", priorBlob: "zzzz", newBlob: "bbbb", head: "c0ffee", path: "results/chatgpt/note.md" },
      now: NOW,
    });
    expect(r.refused.code).toBe("CAS_CONFLICT");
    expect(r.entry.state).toBe("CLAIMED");
    expect(r.entry.lastError).toBe("CAS_CONFLICT");
  });

  it("lost reply: re-recording a delivered operation returns the same receipt", () => {
    const c = claimed("op1", "a1");
    const first = recordDelivery({
      entries: c.entries, operationId: "op1", owner: "a1", generation: 1,
      gitResponse: { repo: "onyxgolden/forge-ai-drop", priorBlob: "aaaa", newBlob: "bbbb", head: "c0ffee", path: "results/chatgpt/note.md" },
      now: NOW,
    });
    const second = recordDelivery({
      entries: first.entries, operationId: "op1", owner: "a1", generation: 1,
      gitResponse: { repo: "onyxgolden/forge-ai-drop", priorBlob: "aaaa", newBlob: "bbbb", head: "c0ffee", path: "results/chatgpt/note.md" },
      now: NOW,
    });
    expect(second.alreadyDelivered).toBe(true);
    expect(second.receipt).toEqual(first.receipt);
    expect(second.entries).toHaveLength(1);
  });

  it("delivery with the wrong generation is STALE_LEASE", () => {
    const c = claimed("op1", "a1");
    expect(() =>
      recordDelivery({
        entries: c.entries, operationId: "op1", owner: "a1", generation: 7,
        gitResponse: { repo: "onyxgolden/forge-ai-drop", priorBlob: "aaaa", newBlob: "bbbb", head: "c0ffee", path: "results/chatgpt/note.md" },
        now: NOW,
      }),
    ).toThrowError(/does not match owner\/generation/);
  });

  it("delivery to the wrong path is PATH_MISMATCH", () => {
    const c = claimed("op1", "a1");
    expect(() =>
      recordDelivery({
        entries: c.entries, operationId: "op1", owner: "a1", generation: 1,
        gitResponse: { repo: "onyxgolden/forge-ai-drop", priorBlob: "aaaa", newBlob: "bbbb", head: "c0ffee", path: "results/claude/other.md" },
        now: NOW,
      }),
    ).toThrowError(/does not match outbox target/);
  });
});

describe("status and receipt exporters", () => {
  it("status export counts states, names the oldest, and lists escalations", () => {
    const tasks = [
      createTask({ id: "old", goal: "g", filedAt: "2026-10-27T06:00:00Z" }),
      createTask({ id: "young", goal: "g", filedAt: T0 }),
    ];
    const status = exportStatus({ tasks, now: NOW });
    expect(status.taskCounts.QUEUED).toBe(2);
    expect(status.oldest.id).toBe("old");
    expect(status.oldestAgeMs).toBe(Date.parse(NOW) - Date.parse("2026-10-27T06:00:00Z"));
    expect(status.escalations.map((e) => e.id)).toEqual(["old"]);
    expect(status.escalations[0].action).toBe("REPING_DUE");
  });

  it("receipt export is canonical: key order independent and payload-free", () => {
    const a = createTask({ id: "t", goal: "g", filedAt: T0 });
    const b = { ...a, result: { status: "done", outputs: { secret: "must-not-appear" } }, status: "DONE" };
    const receipt = exportReceipt(b);
    expect(receipt).not.toContain("must-not-appear");
    expect(exportReceipt(b)).toBe(receipt);
    expect(JSON.parse(receipt).status).toBe("DONE");
  });
});
