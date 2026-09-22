import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route.js";

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_KEY = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

describe("capture config route", () => {
  const savedUrl = process.env[URL_KEY];
  const savedKey = process.env[KEY_KEY];

  afterEach(() => {
    if (savedUrl === undefined) delete process.env[URL_KEY];
    else process.env[URL_KEY] = savedUrl;
    if (savedKey === undefined) delete process.env[KEY_KEY];
    else process.env[KEY_KEY] = savedKey;
  });

  it("serves the public Supabase connection values the desktop app needs", async () => {
    process.env[URL_KEY] = "https://example.supabase.co";
    process.env[KEY_KEY] = "sb_publishable_test";

    const result = await GET();
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toEqual({ supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "sb_publishable_test" });
  });

  it("fails closed when the values are not configured", async () => {
    delete process.env[URL_KEY];
    delete process.env[KEY_KEY];

    const result = await GET();

    expect(result.status).toBe(500);
  });
});
