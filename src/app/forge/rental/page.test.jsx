import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((url) => { throw new Error(`REDIRECT:${url}`); }),
  resolveRentalLanding: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/application/rental/resolveRentalLanding", () => ({
  resolveRentalLanding: mocks.resolveRentalLanding,
}));
vi.mock("@/components/forge/rental/RentalPageClient", () => ({
  default: function StubRentalPageClient({ initialSection }) {
    return <section data-stub-rental-client data-initial-section={String(initialSection)} />;
  },
}));

import RentalPage from "./page";

function configureUser(user) {
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
  });
}

describe("/forge/rental", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveRentalLanding.mockResolvedValue(null);
  });

  it("passes the ?section= param through as the client's initial section", async () => {
    configureUser({ id: "owner_1" });
    const element = await RentalPage({ searchParams: Promise.resolve({ section: "properties" }) });
    expect(element.props.initialSection).toBe("properties");
  });

  it("passes null as the initial section when the param is missing, landing on the dashboard", async () => {
    configureUser({ id: "owner_1" });
    const element = await RentalPage({ searchParams: Promise.resolve({}) });
    expect(element.props.initialSection).toBeNull();
  });

  it("redirects before rendering when resolveRentalLanding returns a tenant-portal destination", async () => {
    configureUser({ id: "tenant_1" });
    mocks.resolveRentalLanding.mockResolvedValue("/forge/rental/portal");
    await expect(RentalPage({ searchParams: Promise.resolve({ section: "properties" }) })).rejects.toThrow("REDIRECT:/forge/rental/portal");
    expect(mocks.redirect).toHaveBeenCalledWith("/forge/rental/portal");
  });
});
