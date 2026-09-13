import { describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn(() => ({ kind: "server-only" })) }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
import { createPublicReservationClient } from "./createPublicReservationClient";

describe("createPublicReservationClient", () => {
  it("uses only the server-held service key and disables sessions", () => {
    expect(createPublicReservationClient({ NEXT_PUBLIC_SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "service-secret" })).toEqual({ kind: "server-only" });
    expect(createClient).toHaveBeenCalledWith("https://db.test", "service-secret", { auth: { persistSession: false, autoRefreshToken: false } });
  });
  it("fails closed without the service key", () => expect(() => createPublicReservationClient({ NEXT_PUBLIC_SUPABASE_URL: "https://db.test" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/));
});
