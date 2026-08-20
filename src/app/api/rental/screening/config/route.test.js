import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticated = { user: { id: "owner_1" }, supabaseClient: {} };
const unauthenticatedResponse = { response: new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 }) };
const createAuthenticatedForgeApplication = vi.fn(async () => authenticated);
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: (...args) => createAuthenticatedForgeApplication(...args) }));

const resolveSmartMoveDestination = vi.fn(() => ({ url: "https://www.mysmartmove.com/", affiliateActive: false }));
vi.mock("@/lib/rental/screeningProviderConfig", () => ({ resolveSmartMoveDestination: (...args) => resolveSmartMoveDestination(...args) }));

import { GET } from "./route.js";

describe("rental screening config route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAuthenticatedForgeApplication.mockResolvedValue(authenticated);
    resolveSmartMoveDestination.mockReturnValue({ url: "https://www.mysmartmove.com/", affiliateActive: false });
  });

  it("rejects unauthenticated callers", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue(unauthenticatedResponse);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("reports affiliateActive:false when the resolver is in non-affiliate mode", async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ smartMove: { affiliateActive: false } });
  });

  it("reports affiliateActive:true once the resolver activates affiliate mode", async () => {
    resolveSmartMoveDestination.mockReturnValue({ url: "https://approved-network.example/track/smartmove", affiliateActive: true });
    const response = await GET();
    const body = await response.json();
    expect(body).toEqual({ smartMove: { affiliateActive: true } });
  });

  it("never exposes the raw destination URL, only the affiliate flag", async () => {
    resolveSmartMoveDestination.mockReturnValue({ url: "https://approved-network.example/track/smartmove?secret=1", affiliateActive: true });
    const response = await GET();
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("approved-network.example");
  });
});
