import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((url) => { throw new Error(`REDIRECT:${url}`); }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/components/forge/reservations/ReservationsPageClient", () => ({
  default: function StubReservationsPageClient() { return <section data-stub-reservations-client />; },
}));

import ReservationsPage from "./page";

function configureUser(user) {
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
  });
}

describe("/forge/reservations", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("sends unauthenticated visitors to /auth instead of rendering the reservation surfaces", async () => {
    configureUser(null);
    await expect(ReservationsPage()).rejects.toThrow("REDIRECT:/auth");
    expect(mocks.redirect).toHaveBeenCalledWith("/auth");
  });

  it("renders the reservations workspace for an authenticated owner", async () => {
    configureUser({ id: "owner_1" });
    const element = await ReservationsPage();
    expect(element.type.name).toBe("StubReservationsPageClient");
  });
});
