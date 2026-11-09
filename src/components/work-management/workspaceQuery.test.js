// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { withWorkspaceQuery } from "./workspaceQuery";

function setSearch(search) {
  vi.stubGlobal("window", { location: { search } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("withWorkspaceQuery", () => {
  it("returns the path unchanged when no workspace is selected", () => {
    setSearch("");
    expect(withWorkspaceQuery("/api/work-packages/wp_1")).toBe("/api/work-packages/wp_1");
  });

  it("appends ?workspace= to a path with no query string", () => {
    setSearch("?workspace=owner-uuid-2");
    expect(withWorkspaceQuery("/api/work-packages/wp_1")).toBe("/api/work-packages/wp_1?workspace=owner-uuid-2");
  });

  it("appends &workspace= to a path that already has a query string", () => {
    setSearch("?workspace=owner-uuid-2");
    expect(withWorkspaceQuery("/api/work-links?packageId=wp_1")).toBe(
      "/api/work-links?packageId=wp_1&workspace=owner-uuid-2",
    );
  });

  it("leaves a path that already carries a workspace param alone", () => {
    setSearch("?workspace=owner-uuid-2");
    expect(withWorkspaceQuery("/api/work-packages/wp_1?workspace=owner-uuid-9")).toBe(
      "/api/work-packages/wp_1?workspace=owner-uuid-9",
    );
  });

  it("URL-encodes the selected workspace", () => {
    setSearch("?workspace=owner%20uuid");
    expect(withWorkspaceQuery("/api/work-packages/wp_1")).toBe("/api/work-packages/wp_1?workspace=owner%20uuid");
  });
});
