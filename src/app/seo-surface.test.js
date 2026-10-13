import { describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((href) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  useRouter: vi.fn(() => ({ refresh: vi.fn() })),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn) => fn,
}));

// Chainable supabase stub — enough for module load; page components are
// never invoked in this suite.
const chainable = () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: [], count: 0 }),
    maybeSingle: () => Promise.resolve({ data: null, count: 0 }),
  };
  return builder;
};
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => chainable() },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/supabase/loadProgrammerAuthorization", () => ({
  loadProgrammerAuthorization: vi.fn(),
}));
vi.mock("@/lib/workspaces", () => ({ WORKSPACES: [] }));
vi.mock("@/domains/business", () => ({ BusinessRepository: class {} }));

// Component stubs for every module the pages import.
vi.mock("@/components/Header", () => ({
  default: () => React.createElement("div"),
}));
vi.mock("@/components/WorkspaceHubGrid", () => ({
  default: () => React.createElement("div"),
}));
vi.mock("@/components/WorkspaceAccountPanel", () => ({
  default: () => React.createElement("div"),
}));
vi.mock("@/components/forge/RealEstateWorkspaceNavigation", () => ({
  default: () => React.createElement("div"),
}));
vi.mock("@/components/DeleteJobButton", () => ({
  default: () => React.createElement("div"),
}));
vi.mock("@/components/DeletePetButton", () => ({
  default: () => React.createElement("div"),
}));
vi.mock("@/components/ShareButton", () => ({
  default: () => React.createElement("div"),
}));
vi.mock("@/components/VotePetButton", () => ({
  default: () => React.createElement("div"),
}));
vi.mock("@/components/BusinessAdminControls", () => ({
  default: () => React.createElement("div"),
}));
const homeComponentStub = {
  default: () => React.createElement("div"),
};
vi.mock("@/components/home/HomeLaunchBanner", () => homeComponentStub);
vi.mock("@/components/home/HomeHero", () => homeComponentStub);
vi.mock("@/components/home/HomeCategories", () => homeComponentStub);
vi.mock("@/components/home/HomePetOfWeek", () => homeComponentStub);
vi.mock("@/components/home/HomeFeaturedListings", () => homeComponentStub);
vi.mock("@/components/home/HomeBusinessSpotlight", () => homeComponentStub);
vi.mock("@/components/home/HomeCommunityHub", () => homeComponentStub);
vi.mock("@/components/home/HomeCrossPosting", () => homeComponentStub);
vi.mock("@/components/home/HomeMarketplaceStats", () => homeComponentStub);
vi.mock("@/components/home/HomeWhyLocal", () => homeComponentStub);
vi.mock("@/components/home/HomeFooter", () => homeComponentStub);
vi.mock("@/components/home/HomeMobileBottomNav", () => homeComponentStub);

describe("launch-polish SEO surface", () => {
  it("every public page exports a unique, non-placeholder title and description", async () => {
    // Pages are .js files containing JSX, which vitest cannot transform —
    // so assert on the static metadata export in source instead of importing.
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const pages = [
      "page.jsx",
      "market/page.js",
      "browse/page.js",
      "investors/page.js",
      "community/page.js",
      "jobs/page.js",
      "pets/page.js",
      "businesses/page.js",
    ];
    const titles = new Set();
    for (const rel of pages) {
      const src = readFileSync(resolve(here, rel), "utf8");
      const marker = "export const metadata =";
      const start = src.indexOf(marker);
      expect(start, `${rel} must export metadata`).toBeGreaterThanOrEqual(0);
      // Extract the object literal via balanced-brace scan.
      let i = src.indexOf("{", start);
      let depth = 0;
      let end = -1;
      for (let j = i; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") {
          depth--;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      expect(end, `${rel} metadata object must close`).toBeGreaterThan(i);
      const metadata = new Function(
        `"use strict"; return (${src.slice(i, end + 1)});`
      )();
      expect(typeof metadata.title, `${rel} title`).toBe("string");
      expect(metadata.title.length, `${rel} title non-empty`).toBeGreaterThan(0);
      expect(typeof metadata.description, `${rel} description`).toBe("string");
      expect(
        metadata.description.length,
        `${rel} description non-empty`
      ).toBeGreaterThan(0);
      expect(
        titles.has(metadata.title),
        `${rel} title must be unique per page (dup: ${metadata.title})`
      ).toBe(false);
      titles.add(metadata.title);
    }
    expect(titles.size).toBe(pages.length);
  });

  it("sitemap lists real public routes as absolute URLs", async () => {
    const { default: sitemap } = await import("./sitemap.js");
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    for (const route of [
      "/",
      "/market",
      "/browse",
      "/investors",
      "/community",
      "/businesses",
      "/jobs",
      "/pets",
      "/privacy",
      "/terms",
    ]) {
      expect(
        urls,
        `sitemap must include ${route}`
      ).toContain(`https://www.409marketplace.online${route}`);
    }
    // Auth-gated and internal routes stay out of the sitemap.
    for (const u of urls) {
      expect(u).not.toMatch(/\/(auth|forge|my-listings|api|admin)/);
    }
  });

  it("robots references the sitemap and keeps internals out of crawlers", async () => {
    const { default: robots } = await import("./robots.js");
    const result = robots();
    expect(result.sitemap).toBe(
      "https://www.409marketplace.online/sitemap.xml"
    );
    const rule = result.rules.find((r) => r.userAgent === "*");
    expect(rule).toBeDefined();
    expect(rule.allow).toContain("/");
    expect(rule.disallow).toEqual(
      expect.arrayContaining(["/auth", "/forge", "/api/", "/admin"])
    );
  });

  it("not-found page renders branded navigation back into the site", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: NotFound } = await import("./not-found.jsx");
    const html = renderToStaticMarkup(React.createElement(NotFound));
    expect(html).toContain("/market");
    expect(html).toContain("/browse");
    expect(html).toMatch(/409 Marketplace/i);
  });
});
