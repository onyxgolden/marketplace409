import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticated = { user: { id: "owner_1" }, supabaseClient: {} };
const unauthenticatedResponse = { response: new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 }) };
const createAuthenticatedForgeApplication = vi.fn(async () => authenticated);
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: (...args) => createAuthenticatedForgeApplication(...args) }));

// The resolver's own affiliate/allowlist/https/credential validation is exhaustively covered in
// screeningProviderConfig.test.js — this route only needs to prove it passes the resolved
// destination straight through, and reads nothing else from the request.
const resolveSmartMoveDestination = vi.fn(() => ({ url: "https://www.mysmartmove.com/", affiliateActive: false }));
vi.mock("@/lib/rental/screeningProviderConfig", () => ({ resolveSmartMoveDestination: (...args) => resolveSmartMoveDestination(...args) }));

import { GET } from "./route.js";

function request(query) {
  return new Request(`https://test/api/rental/screening/redirect${query}`);
}

describe("rental screening redirect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAuthenticatedForgeApplication.mockResolvedValue(authenticated);
    resolveSmartMoveDestination.mockReturnValue({ url: "https://www.mysmartmove.com/", affiliateActive: false });
  });

  it("rejects unauthenticated callers before resolving any destination", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue(unauthenticatedResponse);
    const response = await GET(request("?provider=smartmove"));
    expect(response.status).toBe(401);
    expect(resolveSmartMoveDestination).not.toHaveBeenCalled();
  });

  it("redirects to the resolver's default (non-affiliate) destination", async () => {
    const response = await GET(request("?provider=smartmove"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://www.mysmartmove.com/");
  });

  it("redirects to the resolver's approved affiliate destination once one is active", async () => {
    resolveSmartMoveDestination.mockReturnValue({ url: "https://approved-network.example/track/smartmove?id=forge", affiliateActive: true });
    const response = await GET(request("?provider=smartmove"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://approved-network.example/track/smartmove?id=forge");
  });

  it("ignores any browser-supplied destination/url query parameter — only the provider key is read", async () => {
    const response = await GET(request("?provider=smartmove&url=https://evil.example/steal&destination=https://evil.example/steal"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://www.mysmartmove.com/");
    expect(resolveSmartMoveDestination).toHaveBeenCalledWith();
  });

  it("rejects an unsupported provider without redirecting anywhere", async () => {
    const response = await GET(request("?provider=evil-provider"));
    expect(response.status).toBe(400);
    expect(resolveSmartMoveDestination).not.toHaveBeenCalled();
  });

  it("rejects a missing provider without redirecting anywhere", async () => {
    const response = await GET(request(""));
    expect(response.status).toBe(400);
    expect(resolveSmartMoveDestination).not.toHaveBeenCalled();
  });
});
