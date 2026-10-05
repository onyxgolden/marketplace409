import { describe, expect, it, vi } from "vitest";
import {
  createLink, listLinks, getLinkDetail, confirmLink,
  recheckLink, flagLinkStale, unlinkWorkLink,
} from "./workLinks.js";

// Supabase-shaped chain mock supporting the query shapes workLinks uses.
function mockDb(chains = []) {
  const queue = [...chains];
  return {
    from: vi.fn(() => {
      if (queue.length === 0) throw new Error("mockDb: from() called more times than chains queued");
      return queue.shift();
    }),
  };
}

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), order: vi.fn(() => node),
    insert: vi.fn(() => node), update: vi.fn(() => node), delete: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

// exists() builds a maybeSingle chain resolving to a record (endpoint found).
const exists = (id = "x") => chain({ data: { id }, error: null });
const missing = () => chain({ data: null, error: null });

const INPUT = {
  relationship_type: "on_asset",
  source_domain: "workmgmt", source_type: "work_package", source_id: "forge_wp_1",
  target_domain: "workmgmt", target_type: "forge_work_asset", target_id: "forge_wasset_1",
};

const LINK = {
  id: "forge_wlink_1", owner_id: "owner_1",
  relationship_type: "on_asset",
  source_domain: "workmgmt", source_type: "work_package", source_id: "forge_wp_1",
  target_domain: "workmgmt", target_type: "forge_work_asset", target_id: "forge_wasset_1",
  provenance: "user_confirmed", status: "active",
  created_by: "user_1",
};

describe("createLink", () => {
  it("creates a link and promotes it to active on first resolution", async () => {
    const insertChain = chain({ data: { ...LINK, status: "unresolved" }, error: null });
    const promoteChain = chain({ data: { ...LINK, status: "active" }, error: null });
    const db = mockDb([exists("forge_wp_1"), exists("forge_wasset_1"), insertChain, promoteChain]);
    const result = await createLink(db, { ownerId: "owner_1", actor: "user_1", input: INPUT });
    expect(result.ok).toBe(true);
    expect(result.link.status).toBe("active");
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: "owner_1", relationship_type: "on_asset", status: "unresolved",
      provenance: "user_confirmed", created_by: "user_1",
    }));
    expect(promoteChain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "active", resolved_state: "ok",
    }));
  });
  it("rejects when the source endpoint is missing, naming it", async () => {
    const db = mockDb([missing(), exists("forge_wasset_1")]);
    const result = await createLink(db, { ownerId: "owner_1", actor: "user_1", input: INPUT });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/workmgmt\.work_package 'forge_wp_1' not found in this workspace/);
  });
  it("rejects linking a superseded document version", async () => {
    const supersededDoc = chain({ data: { id: "work_document_1", is_current_version: false, deleted_at: null }, error: null });
    const db = mockDb([exists("forge_wp_1"), supersededDoc]);
    const result = await createLink(db, { ownerId: "owner_1", actor: "user_1", input: {
      relationship_type: "library_supporting_document",
      source_domain: "workmgmt", source_type: "work_package", source_id: "forge_wp_1",
      target_domain: "workmgmt", target_type: "forge_work_document", target_id: "work_document_1",
    }});
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/superseded version/);
  });
  it("rejects a reverse-orientation link before touching the DB", async () => {
    const db = mockDb([]);
    const result = await createLink(db, { ownerId: "owner_1", actor: "user_1", input: {
      ...INPUT,
      source_domain: "workmgmt", source_type: "forge_work_asset", source_id: "forge_wasset_1",
      target_domain: "workmgmt", target_type: "work_package", target_id: "forge_wp_1",
    }});
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("rejects an unresolvable-but-vocabulary-valid relationship type", async () => {
    const db = mockDb([]);
    const result = await createLink(db, { ownerId: "owner_1", actor: "user_1", input: {
      relationship_type: "contains_package",
      source_domain: "workmgmt", source_type: "project", source_id: "p1",
      target_domain: "workmgmt", target_type: "work_package", target_id: "forge_wp_1",
    }});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no verified authoritative table yet/);
  });
  it("maps duplicate links to 409", async () => {
    const dupChain = chain({ data: null, error: { code: "23505", message: "duplicate" } });
    const db = mockDb([exists("forge_wp_1"), exists("forge_wasset_1"), dupChain]);
    const result = await createLink(db, { ownerId: "owner_1", actor: "user_1", input: INPUT });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(result.error).toMatch(/already exists/);
  });
  it("records a brain proposal as ai_proposed without confirmation", async () => {
    const insertChain = chain({ data: { ...LINK, provenance: "ai_proposed" }, error: null });
    const promoteChain = chain({ data: { ...LINK, provenance: "ai_proposed", status: "active" }, error: null });
    const db = mockDb([exists("forge_wp_1"), exists("forge_wasset_1"), insertChain, promoteChain]);
    const result = await createLink(db, { ownerId: "owner_1", actor: "brain-proposal", input: {
      ...INPUT, provenance: "ai_proposed",
    }});
    expect(result.ok).toBe(true);
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      provenance: "ai_proposed", created_by: "brain-proposal", confirmed_by: null,
    }));
  });
  it("rejects a human filing a fake brain proposal", async () => {
    const db = mockDb([]);
    const result = await createLink(db, { ownerId: "owner_1", actor: "user_1", input: {
      ...INPUT, created_by: "brain-proposal", provenance: "ai_proposed",
    }});
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/Only 'brain-proposal' may create 'ai_proposed' links/);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("ignores a caller-supplied created_by and stamps the actor", async () => {
    const insertChain = chain({ data: { ...LINK, status: "unresolved" }, error: null });
    const promoteChain = chain({ data: { ...LINK, status: "active" }, error: null });
    const db = mockDb([exists("forge_wp_1"), exists("forge_wasset_1"), insertChain, promoteChain]);
    const result = await createLink(db, { ownerId: "owner_1", actor: "user_1", input: {
      ...INPUT, created_by: "owner_1",
    }});
    expect(result.ok).toBe(true);
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      created_by: "user_1",
    }));
    expect(insertChain.insert).not.toHaveBeenCalledWith(expect.objectContaining({
      created_by: "owner_1",
    }));
  });
});

describe("listLinks", () => {
  it("merges source-side and target-side queries for a package filter", async () => {
    const asSource = chain({ data: [{ ...LINK, id: "l1", created_at: "2026-10-02T01:00:00Z" }], error: null });
    const asTarget = chain({ data: [
      { ...LINK, id: "l1", created_at: "2026-10-02T01:00:00Z" },
      { ...LINK, id: "l2", created_at: "2026-10-02T02:00:00Z" },
    ], error: null });
    const db = mockDb([asSource, asTarget]);
    const result = await listLinks(db, { ownerId: "owner_1", packageId: "forge_wp_1" });
    expect(result.ok).toBe(true);
    expect(result.links.map((l) => l.id)).toEqual(["l2", "l1"]);
  });
  it("lists all links without a package filter", async () => {
    const all = chain({ data: [LINK], error: null });
    const db = mockDb([all]);
    const result = await listLinks(db, { ownerId: "owner_1" });
    expect(result.ok).toBe(true);
    expect(result.links).toHaveLength(1);
  });
});

describe("getLinkDetail", () => {
  it("returns the link with its confirmation history", async () => {
    const linkChain = chain({ data: LINK, error: null });
    const confChain = chain({ data: [{ id: "c1", confirmed_by: "user_9" }], error: null });
    const db = mockDb([linkChain, confChain]);
    const result = await getLinkDetail(db, { ownerId: "owner_1", linkId: "forge_wlink_1" });
    expect(result.ok).toBe(true);
    expect(result.confirmations).toHaveLength(1);
  });
  it("404s on a missing link", async () => {
    const db = mockDb([missing()]);
    const result = await getLinkDetail(db, { ownerId: "owner_1", linkId: "nope" });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
  });
});

describe("confirmLink", () => {
  const proposed = { ...LINK, provenance: "ai_proposed", confirmed_by: null, confirmed_at: null };
  it("writes the confirmation record then flips provenance", async () => {
    const loadChain = chain({ data: proposed, error: null });
    const confChain = chain({ data: { id: "forge_wlconf_1", prior_provenance: "ai_proposed" }, error: null });
    const updateChain = chain({ data: { ...proposed, provenance: "user_confirmed" }, error: null });
    const db = mockDb([loadChain, confChain, updateChain]);
    const result = await confirmLink(db, { ownerId: "owner_1", actor: "user_9",
      linkId: "forge_wlink_1", note: "Verified against the schedule." });
    expect(result.ok).toBe(true);
    expect(result.link.provenance).toBe("user_confirmed");
    expect(confChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      link_id: "forge_wlink_1", confirmed_by: "user_9", prior_provenance: "ai_proposed",
    }));
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      provenance: "user_confirmed", confirmed_by: "user_9",
    }));
  });
  it("refuses to confirm an already-confirmed link", async () => {
    const db = mockDb([chain({ data: LINK, error: null })]);
    const result = await confirmLink(db, { ownerId: "owner_1", actor: "user_9", linkId: "forge_wlink_1" });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
  });
  it("refuses brain-proposal as the confirmer", async () => {
    const db = mockDb([chain({ data: proposed, error: null })]);
    const result = await confirmLink(db, { ownerId: "owner_1", actor: "brain-proposal", linkId: "forge_wlink_1" });
    expect(result.ok).toBe(false);
  });
});

describe("recheckLink", () => {
  it("marks a link broken when an endpoint disappears", async () => {
    const loadChain = chain({ data: LINK, error: null });
    const updateChain = chain({ data: { ...LINK, status: "broken" }, error: null });
    const db = mockDb([loadChain, exists("forge_wp_1"), missing(), updateChain]);
    const result = await recheckLink(db, { ownerId: "owner_1", linkId: "forge_wlink_1" });
    expect(result.ok).toBe(true);
    expect(result.link.status).toBe("broken");
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "broken", resolved_state: "unavailable",
    }));
  });
  it("returns a broken link to active when both endpoints resolve", async () => {
    const loadChain = chain({ data: { ...LINK, status: "broken" }, error: null });
    const updateChain = chain({ data: { ...LINK, status: "active" }, error: null });
    const db = mockDb([loadChain, exists("forge_wp_1"), exists("forge_wasset_1"), updateChain]);
    const result = await recheckLink(db, { ownerId: "owner_1", linkId: "forge_wlink_1" });
    expect(result.ok).toBe(true);
    expect(result.link.status).toBe("active");
  });
  it("marks a link stale when its document endpoint is superseded", async () => {
    const docLink = { ...LINK, relationship_type: "library_supporting_document",
      target_domain: "workmgmt", target_type: "forge_work_document", target_id: "work_document_1" };
    const loadChain = chain({ data: docLink, error: null });
    const updateChain = chain({ data: { ...docLink, status: "stale" }, error: null });
    const supersededDoc = chain({ data: { id: "work_document_1", is_current_version: false, deleted_at: null }, error: null });
    const db = mockDb([loadChain, exists("forge_wp_1"), supersededDoc, updateChain]);
    const result = await recheckLink(db, { ownerId: "owner_1", linkId: "forge_wlink_1" });
    expect(result.ok).toBe(true);
    expect(result.link.status).toBe("stale");
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "stale", resolved_state: "moved",
    }));
  });
  it("marks a link broken when its document endpoint is soft-deleted", async () => {
    const docLink = { ...LINK, relationship_type: "library_supporting_document",
      target_domain: "workmgmt", target_type: "forge_work_document", target_id: "work_document_1" };
    const loadChain = chain({ data: docLink, error: null });
    const updateChain = chain({ data: { ...docLink, status: "broken" }, error: null });
    const deletedDoc = chain({ data: { id: "work_document_1", is_current_version: true, deleted_at: "2026-10-05T00:00:00Z" }, error: null });
    const db = mockDb([loadChain, exists("forge_wp_1"), deletedDoc, updateChain]);
    const result = await recheckLink(db, { ownerId: "owner_1", linkId: "forge_wlink_1" });
    expect(result.ok).toBe(true);
    expect(result.link.status).toBe("broken");
  });
});

describe("flagLinkStale", () => {
  it("flags an active link stale with a reason", async () => {
    const loadChain = chain({ data: LINK, error: null });
    const updateChain = chain({ data: { ...LINK, status: "stale" }, error: null });
    const db = mockDb([loadChain, updateChain]);
    const result = await flagLinkStale(db, { ownerId: "owner_1", linkId: "forge_wlink_1",
      reason: "Drawing revision superseded by rev 4." });
    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "stale", resolved_state: "moved",
    }));
  });
  it("requires a reason", async () => {
    const db = mockDb([chain({ data: LINK, error: null })]);
    const result = await flagLinkStale(db, { ownerId: "owner_1", linkId: "forge_wlink_1", reason: " " });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
  });
  it("appends the stale reason to existing notes instead of overwriting", async () => {
    const withNotes = { ...LINK, notes: "Earlier observation." };
    const loadChain = chain({ data: withNotes, error: null });
    const updateChain = chain({ data: { ...withNotes, status: "stale" }, error: null });
    const db = mockDb([loadChain, updateChain]);
    const result = await flagLinkStale(db, { ownerId: "owner_1", linkId: "forge_wlink_1",
      reason: "Drawing revision superseded by rev 4." });
    expect(result.ok).toBe(true);
    const notes = updateChain.update.mock.calls[0][0].notes;
    expect(notes).toMatch(/Earlier observation\./);
    expect(notes).toMatch(/Drawing revision superseded by rev 4\./);
  });
  it("rejects flagging a broken link stale", async () => {
    const db = mockDb([chain({ data: { ...LINK, status: "broken" }, error: null })]);
    const result = await flagLinkStale(db, { ownerId: "owner_1", linkId: "forge_wlink_1", reason: "moved" });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
  });
});

describe("unlinkWorkLink", () => {
  it("deletes the link row", async () => {
    const loadChain = chain({ data: LINK, error: null });
    const deleteChain = chain({ data: null, error: null });
    const db = mockDb([loadChain, deleteChain]);
    const result = await unlinkWorkLink(db, { ownerId: "owner_1", linkId: "forge_wlink_1" });
    expect(result.ok).toBe(true);
    expect(result.unlinked).toBe("forge_wlink_1");
    expect(deleteChain.delete).toHaveBeenCalled();
  });
  it("404s on a missing link", async () => {
    const db = mockDb([missing()]);
    const result = await unlinkWorkLink(db, { ownerId: "owner_1", linkId: "nope" });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
  });
});
