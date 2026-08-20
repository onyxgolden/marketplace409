import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ImpactSiteVerificationMeta from "./ImpactSiteVerificationMeta";

describe("ImpactSiteVerificationMeta", () => {
  it("renders the exact tag Impact supplied, with the literal value attribute (not content)", () => {
    const html = renderToStaticMarkup(<ImpactSiteVerificationMeta />);
    expect(html).toBe('<meta name="impact-site-verification" value="e72e3994-89a5-4e25-9c42-6bb892d9d0c8"/>');
  });

  it("contains the required name and value exactly once each", () => {
    const html = renderToStaticMarkup(<ImpactSiteVerificationMeta />);
    expect(html.match(/name="impact-site-verification"/g)).toHaveLength(1);
    expect(html.match(/value="e72e3994-89a5-4e25-9c42-6bb892d9d0c8"/g)).toHaveLength(1);
    expect(html.match(/impact-site-verification/g)).toHaveLength(1);
  });

  it("never renders a content= attribute in place of value=", () => {
    const html = renderToStaticMarkup(<ImpactSiteVerificationMeta />);
    expect(html).not.toContain("content=");
  });

  it("adds no tracking script, cookie, or affiliate link", () => {
    const html = renderToStaticMarkup(<ImpactSiteVerificationMeta />);
    expect(html).not.toMatch(/<script|document\.cookie|href=/i);
  });
});
