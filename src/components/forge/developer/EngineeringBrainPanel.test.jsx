import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.stubGlobal("fetch", vi.fn());
import EngineeringBrainPanel, { RelatedFixesSection } from "./EngineeringBrainPanel";

describe("EngineeringBrainPanel", () => {
  it("presents the search surface and its initial loading state", () => {
    const markup = renderToStaticMarkup(<EngineeringBrainPanel />);
    expect(markup).toContain("FORGE Engineering Brain");
    expect(markup).toContain("Search");
    expect(markup).toContain("Searching");
  });

  it("explains upfront that this view has no inline excerpts, rather than silently omitting them", () => {
    const markup = renderToStaticMarkup(<EngineeringBrainPanel />);
    expect(markup).toContain("does not show inline content excerpts");
  });

  it("does not render results or conflicts before the first fetch resolves", () => {
    const markup = renderToStaticMarkup(<EngineeringBrainPanel />);
    expect(markup).not.toContain("unresolved conflict");
    expect(markup).not.toContain("Insufficient evidence");
  });
});

describe("RelatedFixesSection", () => {
  const FIXES = [
    {
      record: {
        sha: "abc123def456789",
        date: "2026-09-28T12:00:00Z",
        subject: "fix: RLS policy blocked tenant reads",
        pr: 500,
        class: "rls",
        files: ["src/app/api/rental/route.js", "supabase/migrations/20260928.sql"],
      },
      score: 5,
      matched_terms: ["rls", "tenant"],
    },
  ];

  it("renders nothing when there are no fixes", () => {
    expect(renderToStaticMarkup(<RelatedFixesSection fixes={[]} />)).toBe("");
    expect(renderToStaticMarkup(<RelatedFixesSection fixes={null} />)).toBe("");
  });

  it("renders each fix with subject, sha, PR, and matched terms", () => {
    const markup = renderToStaticMarkup(<RelatedFixesSection fixes={FIXES} />);
    expect(markup).toContain("Related past fixes");
    expect(markup).toContain("fix: RLS policy blocked tenant reads");
    expect(markup).toContain("abc123def456");
    expect(markup).toContain("PR #500");
    expect(markup).toContain("matched: rls, tenant");
    expect(markup).toContain("src/app/api/rental/route.js");
  });

  it("omits optional fields gracefully", () => {
    const markup = renderToStaticMarkup(
      <RelatedFixesSection fixes={[{ record: { sha: "zzz", subject: "bare fix" }, score: 1 }]} />
    );
    expect(markup).toContain("bare fix");
    expect(markup).not.toContain("PR #");
    expect(markup).not.toContain("matched:");
  });

  it("truncates long file lists", () => {
    const markup = renderToStaticMarkup(
      <RelatedFixesSection fixes={[{
        record: { sha: "a", subject: "s", files: ["f1", "f2", "f3", "f4", "f5", "f6"] },
        score: 1,
      }]} />
    );
    expect(markup).toContain("+2 more");
  });
});
