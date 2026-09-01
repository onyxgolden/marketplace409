import { describe, expect, it } from "vitest";
import { HostNotPermittedError, assertHostPermitted, classifyHost } from "../hostAllowlist.mjs";

describe("classifyHost", () => {
  it("classifies localhost and 127.0.0.1 as local", () => {
    expect(classifyHost("http://localhost:3000/forge").classification).toBe("local");
    expect(classifyHost("http://127.0.0.1:3000/forge").classification).toBe("local");
  });

  it("classifies a real Vercel preview subdomain shape as preview", () => {
    const result = classifyHost("https://marketplace409-jenjhnxsc-jason-morgan-s-projects.vercel.app/forge");
    expect(result.classification).toBe("preview");
    expect(result.reasonCode).toBe("vercel_preview_host");
  });

  // Production-host rejection (explicitly required test coverage): this repo's real production
  // domain is itself a bare *.vercel.app alias, which is exactly why a denylist-first check matters --
  // a naive "any *.vercel.app is a preview" rule would wrongly permit production.
  it("denies the known production host even though it matches the generic vercel.app shape", () => {
    const result = classifyHost("https://marketplace409.vercel.app/forge/financial");
    expect(result.classification).toBe("denied");
    expect(result.reasonCode).toBe("production_host");
  });

  it("denies an unrecognized host rather than defaulting to allowed", () => {
    const result = classifyHost("https://evil.example.com/forge");
    expect(result.classification).toBe("denied");
    expect(result.reasonCode).toBe("unrecognized_host");
  });

  it("denies an unparseable URL", () => {
    expect(classifyHost("not a url").classification).toBe("denied");
    expect(classifyHost("not a url").reasonCode).toBe("unparseable_url");
  });

  it("is case-insensitive on hostname", () => {
    expect(classifyHost("https://MARKETPLACE409.VERCEL.APP/forge").classification).toBe("denied");
  });
});

describe("assertHostPermitted", () => {
  it("returns the classification result for a permitted host", () => {
    expect(assertHostPermitted("http://localhost:3000").classification).toBe("local");
  });

  it("throws HostNotPermittedError for the production host", () => {
    expect(() => assertHostPermitted("https://marketplace409.vercel.app")).toThrow(HostNotPermittedError);
  });

  it("throws HostNotPermittedError for an unrecognized host", () => {
    expect(() => assertHostPermitted("https://not-this-app.example.com")).toThrow(HostNotPermittedError);
  });
});
