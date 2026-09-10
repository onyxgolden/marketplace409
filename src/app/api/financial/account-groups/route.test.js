import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getFinancialApplicationSuite: vi.fn(),
  currentOwnerId: vi.fn(),
  findActiveGroupsForOwner: vi.fn(),
  createGroup: vi.fn(),
  addMember: vi.fn(),
  revokeMember: vi.fn(),
  revokeGroup: vi.fn(),
  setBalanceAuthority: vi.fn(),
  setTransactionAuthority: vi.fn(),
  advanceCoverageStatus: vi.fn(),
  setTransactionCutover: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init) {
      return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    },
  },
}));

vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));

import { GET, POST } from "./route";

function request(body) {
  return new Request("http://localhost/api/financial/account-groups", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authenticatedApplication(overrides = {}) {
  return {
    currentOwnerId: mocks.currentOwnerId,
    getFinancialApplicationSuite: mocks.getFinancialApplicationSuite,
    ...overrides,
  };
}

function repositoryStub() {
  return {
    findActiveGroupsForOwner: mocks.findActiveGroupsForOwner,
    createGroup: mocks.createGroup,
    addMember: mocks.addMember,
    revokeMember: mocks.revokeMember,
    revokeGroup: mocks.revokeGroup,
    setBalanceAuthority: mocks.setBalanceAuthority,
    setTransactionAuthority: mocks.setTransactionAuthority,
    advanceCoverageStatus: mocks.advanceCoverageStatus,
    setTransactionCutover: mocks.setTransactionCutover,
  };
}

describe("GET /api/financial/account-groups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the resolved owner's active groups", async () => {
    mocks.authenticate.mockResolvedValue(authenticatedApplication());
    mocks.currentOwnerId.mockResolvedValue("owner-123");
    mocks.getFinancialApplicationSuite.mockResolvedValue({ financialAccountGroupRepository: repositoryStub() });
    mocks.findActiveGroupsForOwner.mockResolvedValue([{ group: { id: "group-1" }, activeMemberFinancialAccountIds: ["acct-a"] }]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.groups).toHaveLength(1);
    expect(mocks.findActiveGroupsForOwner).toHaveBeenCalledWith("owner-123");
  });

  it("returns the authentication response when unauthenticated", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getFinancialApplicationSuite).not.toHaveBeenCalled();
  });
});

describe("POST /api/financial/account-groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(authenticatedApplication());
    mocks.getFinancialApplicationSuite.mockResolvedValue({ financialAccountGroupRepository: repositoryStub() });
  });

  it("rejects an unsupported action", async () => {
    const response = await POST(request({ action: "delete_everything" }));
    expect(response.status).toBe(400);
    expect(mocks.createGroup).not.toHaveBeenCalled();
  });

  it("create_group: passes the canonical account id and note through, never an ownerId/actorUserId from the request body", async () => {
    mocks.createGroup.mockResolvedValue({ id: "group-1" });

    const response = await POST(request({
      action: "create_group", canonicalFinancialAccountId: "acct-stripe", note: "same real account",
      // Deliberately included, must be ignored -- the RPC itself derives these, this route never
      // even reads them.
      ownerId: "attacker-controlled-owner", actorUserId: "attacker-controlled-actor",
    }));

    expect(response.status).toBe(200);
    expect(mocks.createGroup).toHaveBeenCalledWith({ canonicalFinancialAccountId: "acct-stripe", note: "same real account" });
    const call = mocks.createGroup.mock.calls[0][0];
    expect(call.ownerId).toBeUndefined();
    expect(call.actorUserId).toBeUndefined();
  });

  it("add_member: passes groupId/financialAccountId through", async () => {
    mocks.addMember.mockResolvedValue({ id: "member-1" });
    const response = await POST(request({ action: "add_member", groupId: "group-1", financialAccountId: "acct-manual" }));
    expect(response.status).toBe(200);
    expect(mocks.addMember).toHaveBeenCalledWith({ groupId: "group-1", financialAccountId: "acct-manual" });
  });

  it("revoke_member calls the repository and reports success without echoing any row back", async () => {
    mocks.revokeMember.mockResolvedValue(undefined);
    const response = await POST(request({ action: "revoke_member", memberId: "member-1" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: { revoked: true } });
    expect(mocks.revokeMember).toHaveBeenCalledWith({ memberId: "member-1" });
  });

  it("revoke_group calls the repository", async () => {
    mocks.revokeGroup.mockResolvedValue(undefined);
    const response = await POST(request({ action: "revoke_group", groupId: "group-1" }));
    expect(response.status).toBe(200);
    expect(mocks.revokeGroup).toHaveBeenCalledWith({ groupId: "group-1" });
  });

  it("set_balance_authority passes through", async () => {
    mocks.setBalanceAuthority.mockResolvedValue({ id: "group-1", balanceAuthorityAccountId: "acct-plaid" });
    const response = await POST(request({ action: "set_balance_authority", groupId: "group-1", financialAccountId: "acct-plaid" }));
    expect(response.status).toBe(200);
    expect(mocks.setBalanceAuthority).toHaveBeenCalledWith({ groupId: "group-1", financialAccountId: "acct-plaid" });
  });

  it("set_transaction_authority passes through -- independent from set_balance_authority", async () => {
    mocks.setTransactionAuthority.mockResolvedValue({ id: "group-1", transactionAuthorityAccountId: "acct-manual" });
    const response = await POST(request({ action: "set_transaction_authority", groupId: "group-1", financialAccountId: "acct-manual" }));
    expect(response.status).toBe(200);
    expect(mocks.setTransactionAuthority).toHaveBeenCalledWith({ groupId: "group-1", financialAccountId: "acct-manual" });
    expect(mocks.setBalanceAuthority).not.toHaveBeenCalled();
  });

  it("advance_coverage_status passes through, including an optional note", async () => {
    mocks.advanceCoverageStatus.mockResolvedValue({ id: "group-1", transactionCoverageStatus: "reconciled" });
    const response = await POST(request({ action: "advance_coverage_status", groupId: "group-1", newStatus: "reconciled", note: "manually verified" }));
    expect(response.status).toBe(200);
    expect(mocks.advanceCoverageStatus).toHaveBeenCalledWith({ groupId: "group-1", newStatus: "reconciled", note: "manually verified" });
  });

  it("set_transaction_cutover passes through", async () => {
    mocks.setTransactionCutover.mockResolvedValue({ id: "group-1", transactionCutoverAt: "2026-09-01" });
    const response = await POST(request({ action: "set_transaction_cutover", groupId: "group-1", cutoverDate: "2026-09-01" }));
    expect(response.status).toBe(200);
    expect(mocks.setTransactionCutover).toHaveBeenCalledWith({ groupId: "group-1", cutoverDate: "2026-09-01" });
  });

  it("surfaces a Postgres RAISE EXCEPTION message verbatim (a deliberately user-safe string), as a 400", async () => {
    mocks.createGroup.mockRejectedValue(new Error("This account already belongs to an active group."));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ action: "create_group", canonicalFinancialAccountId: "acct-stripe" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "This account already belongs to an active group." });
    consoleError.mockRestore();
  });

  it("returns the authentication response when unauthenticated, without calling any repository method", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) });

    const response = await POST(request({ action: "create_group", canonicalFinancialAccountId: "acct-stripe" }));

    expect(response.status).toBe(401);
    expect(mocks.createGroup).not.toHaveBeenCalled();
  });
});
