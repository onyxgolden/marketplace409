import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadProgrammerAuthorization: vi.fn(),
  readProposals: vi.fn(),
  applyProposalAction: vi.fn(),
}));
vi.mock("@/lib/supabase/loadProgrammerAuthorization", () => ({ loadProgrammerAuthorization: mocks.loadProgrammerAuthorization }));
vi.mock("../../../../../../../scripts/ui-improvement-manager/finding-engine/proposalStore.mjs", () => ({
  readProposals: mocks.readProposals, applyProposalAction: mocks.applyProposalAction,
  ProposalStoreError: class ProposalStoreError extends Error {
    constructor(reasonCode, detail) { super(detail); this.name = "ProposalStoreError"; this.reasonCode = reasonCode; }
  },
}));

import { GET, POST } from "./route";

const AUTHORIZED = { ok: true, authorized: true, user: { email: "jasonmorgan99@gmail.com" } };
const finding = { findingId: "finding_1", status: "new" };

function jsonRequest(body) {
  return new Request("http://localhost/api/forge/developer/ui-improvement-manager/proposals", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("GET/POST /api/forge/developer/ui-improvement-manager/proposals", () => {
  const originalVercel = process.env.VERCEL;
  beforeEach(() => { vi.clearAllMocks(); delete process.env.VERCEL; });
  afterEach(() => { process.env.VERCEL = originalVercel; });

  it("GET refuses with 403 when running on Vercel, before ever checking authorization", async () => {
    process.env.VERCEL = "1";
    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocks.loadProgrammerAuthorization).not.toHaveBeenCalled();
  });

  it("GET returns 500 when the authorization check itself failed", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: false, message: "auth check failed" });
    const response = await GET();
    expect(response.status).toBe(500);
  });

  it("GET returns 403 for an authenticated but unauthorized caller", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: true, authorized: false, user: null });
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("GET returns the findings manifest for an authorized local caller", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue(AUTHORIZED);
    mocks.readProposals.mockReturnValue({ schemaVersion: "1.0", findings: [finding] });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.findings).toEqual([finding]);
  });

  it("GET returns an empty list (not an error) when no evidence has been captured yet", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue(AUTHORIZED);
    const { ProposalStoreError } = await import("../../../../../../../scripts/ui-improvement-manager/finding-engine/proposalStore.mjs");
    mocks.readProposals.mockImplementation(() => { throw new ProposalStoreError("not_found", "no manifest"); });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.findings).toEqual([]);
  });

  it("POST refuses with 403 when running on Vercel", async () => {
    process.env.VERCEL = "1";
    const response = await POST(jsonRequest({ findingId: "finding_1", action: "reject" }));
    expect(response.status).toBe(403);
    expect(mocks.applyProposalAction).not.toHaveBeenCalled();
  });

  it("POST requires findingId and action", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue(AUTHORIZED);
    const response = await POST(jsonRequest({}));
    expect(response.status).toBe(400);
  });

  it("POST applies the action and returns the updated finding", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue(AUTHORIZED);
    mocks.applyProposalAction.mockReturnValue({ ...finding, status: "rejected" });
    const response = await POST(jsonRequest({ findingId: "finding_1", action: "reject" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.finding.status).toBe("rejected");
    expect(mocks.applyProposalAction).toHaveBeenCalledWith(expect.stringContaining("ui-improvement-manager"), "finding_1", "reject");
  });

  it("POST returns 404 when the finding id is unknown", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue(AUTHORIZED);
    const { ProposalStoreError } = await import("../../../../../../../scripts/ui-improvement-manager/finding-engine/proposalStore.mjs");
    mocks.applyProposalAction.mockImplementation(() => { throw new ProposalStoreError("not_found", "No finding with that id."); });
    const response = await POST(jsonRequest({ findingId: "nope", action: "reject" }));
    expect(response.status).toBe(404);
  });

  it("POST never calls any git/deploy-related API -- only proposalStore's applyProposalAction", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue(AUTHORIZED);
    mocks.applyProposalAction.mockReturnValue({ ...finding, status: "preview_approved" });
    await POST(jsonRequest({ findingId: "finding_1", action: "approve_preview" }));
    expect(mocks.applyProposalAction).toHaveBeenCalledTimes(1);
  });

  it("treats findingId as an opaque lookup key, never as a filesystem path -- a path-traversal-shaped id is passed through unmodified, not resolved", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue(AUTHORIZED);
    const { ProposalStoreError } = await import("../../../../../../../scripts/ui-improvement-manager/finding-engine/proposalStore.mjs");
    mocks.applyProposalAction.mockImplementation(() => { throw new ProposalStoreError("not_found", "No finding with that id."); });
    const traversal = "../../../../../../etc/passwd";
    const response = await POST(jsonRequest({ findingId: traversal, action: "reject" }));
    expect(response.status).toBe(404);
    // The exact string reaches proposalStore untouched -- it is never joined into a path or resolved
    // by this route before being handed off, so proposalStore's own array .find() lookup (never a
    // filesystem read keyed by this value) is the only thing that ever sees it.
    expect(mocks.applyProposalAction.mock.calls[0][1]).toBe(traversal);
  });

  it("always targets the same fixed local evidence directory regardless of request-supplied values", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue(AUTHORIZED);
    mocks.applyProposalAction.mockReturnValue({ ...finding, status: "rejected" });
    await POST(jsonRequest({ findingId: "finding_1", action: "reject", evidenceDir: "/tmp/attacker-controlled" }));
    const [evidenceDirArg] = mocks.applyProposalAction.mock.calls[0];
    expect(evidenceDirArg).not.toContain("attacker-controlled");
    expect(evidenceDirArg).toContain("ui-improvement-manager");
  });
});
