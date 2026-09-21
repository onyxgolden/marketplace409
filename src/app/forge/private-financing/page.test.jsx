import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((url) => { throw new Error(`REDIRECT:${url}`); }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/components/forge/private-financing/PrivateFinancingPageClient", () => ({
  default: function StubPrivateFinancingPageClient() { return <section data-stub-pf-client />; },
}));

import PrivateFinancingPage from "./page";

function configureUser(user) {
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
  });
}

describe("/forge/private-financing", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("sends unauthenticated visitors to /auth instead of rendering the accounts surface", async () => {
    configureUser(null);
    await expect(PrivateFinancingPage()).rejects.toThrow("REDIRECT:/auth");
    expect(mocks.redirect).toHaveBeenCalledWith("/auth");
  });

  it("renders the owner accounts surface for an authenticated owner", async () => {
    configureUser({ id: "owner_1" });
    const element = await PrivateFinancingPage();
    expect(element.type.name).toBe("StubPrivateFinancingPageClient");
  });
});
