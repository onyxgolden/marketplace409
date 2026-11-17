// Work Packages landing header (Phone Slice 5): below the sm breakpoint
// the header stacks into two rows — heading above, actions below —
// because the single row needs ~372px plus the page's 32px of padding
// and pushed the New package link past the viewport edge at 360/390px.
// At sm and up it is the original row, unchanged. The Chromium geometry
// check is the real proof (all three links inside the viewport at
// 360/390/412/430); these tests pin the responsive structure and that
// the links survive the restack.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import WorkPackagePageHeader from "./page-header";

const PROPS = {
  heading: "Work Packages",
  subheading:
    "Rung 1: the authoritative Work Package core domain. Typed links, readiness, and dashboards arrive in later rungs.",
  newPackageHref: "/forge/work/new",
};

describe("WorkPackagePageHeader", () => {
  it("stacks into two rows below sm and returns to a row at sm and up", () => {
    const html = renderToStaticMarkup(<WorkPackagePageHeader {...PROPS} />);
    expect(html).toContain("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between");
  });

  it("renders the heading, subheading, and all three actions", () => {
    const html = renderToStaticMarkup(<WorkPackagePageHeader {...PROPS} />);
    expect(html).toContain("Work Packages");
    expect(html).toContain("Rung 1: the authoritative Work Package core domain.");
    expect(html).toContain('href="/forge/work/documents"');
    expect(html).toContain("Document library");
    expect(html).toContain('href="/forge/work/admin"');
    expect(html).toContain("Admin");
    expect(html).toContain('href="/forge/work/new"');
    expect(html).toContain("New package");
  });

  it("lets the action row wrap rather than overflow on a very narrow pane", () => {
    const html = renderToStaticMarkup(<WorkPackagePageHeader {...PROPS} />);
    expect(html).toContain("flex flex-wrap items-center gap-2");
  });
});
