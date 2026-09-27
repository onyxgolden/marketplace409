import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
vi.mock("@/application/rental/bankReconciliationService", async (orig) => {
  const actual = await orig();
  return { ...actual, saveReconciliation: vi.fn(async () => ({ reconciliation: { id: "rec_1" }, result: { balanced: true } })), undoReconciliation: vi.fn(async () => ({ reconciliation: { id: "rec_1", status: "undone" }, restored: 2 })) };
});
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { ReconciliationError, saveReconciliation, undoReconciliation } from "@/application/rental/bankReconciliationService";
import { GET, POST } from "./route";

const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  createAuthenticatedRentalManagerApplication.mockResolvedValue({ user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: {} });
  getActiveWorkspaceRole.mockResolvedValue("owner");
});

describe("bank reconciliations API", () => {
  it("requires the typed CONFIRM for any write", async () => {
    const res = await post({ action: "save" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/CONFIRM/);
    expect(saveReconciliation).not.toHaveBeenCalled();
  });

  it("refuses read-only members", async () => {
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    expect((await post({ action: "save", confirm: "CONFIRM" })).status).toBe(403);
  });

  it("routes save and undo under the effective owner", async () => {
    expect((await post({ action: "save", confirm: "CONFIRM", bankAccountId: "a" })).status).toBe(200);
    expect(saveReconciliation.mock.calls[0][1]).toEqual({ ownerId: "owner_1", userId: "user_1" });
    const res = await post({ action: "undo", confirm: "CONFIRM", id: "rec_1", reason: "x" });
    expect(await res.json()).toMatchObject({ success: true, restored: 2 });
    expect(undoReconciliation).toHaveBeenCalled();
    expect((await post({ action: "nope", confirm: "CONFIRM" })).status).toBe(400);
  });

  it("maps service errors to their status", async () => {
    saveReconciliation.mockRejectedValueOnce(new ReconciliationError("already reconciled", 409));
    const res = await post({ action: "save", confirm: "CONFIRM" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already reconciled");
  });

  it("GET requires an account and passes auth failures through", async () => {
    expect((await GET(new Request("https://t/"))).status).toBe(400);
    const denied = new Response(null, { status: 401 });
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ response: denied });
    expect(await GET(new Request("https://t/?bankAccountId=a"))).toBe(denied);
  });
});
