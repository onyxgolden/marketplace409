// FORGE Doc-to-Overview — slice A: sanitization tests.

import { describe, expect, it } from "vitest";
import { escapeHtml, isSafePathSegment, sanitizeSvg } from "./sanitize.js";

describe("escapeHtml", () => {
  it("escapes markup so source text can never render as HTML", () => {
    const out = escapeHtml('<script>alert("x")</script> & \'quotes\'');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&amp;");
    expect(out).toContain("&quot;");
    expect(out).toContain("&#39;");
  });
});

describe("sanitizeSvg", () => {
  const malicious = `<svg xmlns="http://www.w3.org/2000/svg" onload="evil()">
<script>alert(1)</script>
<rect x="1" y="2" width="10" height="10" fill="red" onclick="evil()" />
<image href="http://evil.example/x.png" />
<a href="javascript:alert(1)"><text>click</text></a>
<foreignObject><div>hostile</div></foreignObject>
</svg>`;

  it("removes scripts, handlers, external refs and active elements, keeping benign shapes", () => {
    const out = sanitizeSvg(malicious);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onload");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("http://evil.example");
    expect(out).not.toContain("<image");
    expect(out).not.toContain("foreignObject");
    expect(out).toContain("<rect");
    expect(out).toContain('fill="red"');
    expect(out).toContain("click");
  });

  it("keeps same-document fragment links and drops the rest", () => {
    const out = sanitizeSvg('<svg><use href="#shape" /><use href="https://evil.example/s.svg" /></svg>');
    expect(out).toContain('href="#shape"');
    expect(out).not.toContain("https://evil.example");
  });

  it("returns empty for non-strings", () => {
    expect(sanitizeSvg(null)).toBe("");
    expect(sanitizeSvg(42)).toBe("");
  });
});

describe("isSafePathSegment", () => {
  it("accepts plain identifiers and refuses traversal, separators and hidden names", () => {
    expect(isSafePathSegment("owner_123-ABC")).toBe(true);
    expect(isSafePathSegment("../evil")).toBe(false);
    expect(isSafePathSegment("a/b")).toBe(false);
    expect(isSafePathSegment("a\\b")).toBe(false);
    expect(isSafePathSegment(".hidden")).toBe(false);
    expect(isSafePathSegment("..")).toBe(false);
    expect(isSafePathSegment("")).toBe(false);
  });
});
