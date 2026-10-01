import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  listTemplatePlaceholders,
  noticeTextToHtml,
  renderNoticeTemplate,
  UNKNOWN_PLACEHOLDER_MARK,
} from "../formPlaceholders";

const CONTEXT = {
  tenant: { name: "Eric Carrillo", email: "eric.carillo5@yahoo.com", phone: "555-0100" },
  property: { label: "308 Paula", address: "308 Paula St, Beaumont, TX 77705" },
  unit: { label: "A" },
  lease: { start: "Sep 1, 2026", end: "Aug 31, 2027", rent: "$1,600.00", due_day: "1" },
  balance: { due: "$1,600.00" },
  owner: { name: "409 Marketplace" },
  custom: { gate_code: "4821", parking_spot: "A1" },
  today: "Oct 1, 2026",
};

describe("placeholder engine", () => {
  it("substitutes every built-in placeholder type", () => {
    const body = [
      "{{tenant.name}} owes {{balance.due}} for {{property.label}} at {{property.address}}.",
      "Lease {{lease.start}} to {{lease.end}}, {{lease.rent}} due day {{lease.due_day}}.",
      "Call {{tenant.phone}} or email {{tenant.email}}. Unit {{unit.label}}. — {{owner.name}}, {{today}}",
    ].join("\n");
    const { text, missing, unknown } = renderNoticeTemplate(body, CONTEXT);
    expect(text).toBe(
      "Eric Carrillo owes $1,600.00 for 308 Paula at 308 Paula St, Beaumont, TX 77705.\n" +
        "Lease Sep 1, 2026 to Aug 31, 2027, $1,600.00 due day 1.\n" +
        "Call 555-0100 or email eric.carillo5@yahoo.com. Unit A. — 409 Marketplace, Oct 1, 2026",
    );
    expect(missing).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it("substitutes custom field placeholders", () => {
    const { text } = renderNoticeTemplate("Gate {{custom.gate_code}}, spot {{custom.parking_spot}}.", CONTEXT);
    expect(text).toBe("Gate 4821, spot A1.");
  });

  it("blanks known-but-empty values and lists them as missing", () => {
    const sparse = { ...CONTEXT, tenant: { ...CONTEXT.tenant, phone: null }, lease: { ...CONTEXT.lease, end: "" } };
    const { text, missing } = renderNoticeTemplate("Phone: {{tenant.phone}} / End: {{lease.end}} / Name: {{tenant.name}}", sparse);
    expect(text).toBe("Phone:  / End:  / Name: Eric Carrillo");
    expect(missing).toEqual(expect.arrayContaining(["tenant.phone", "lease.end"]));
    expect(missing).not.toContain("tenant.name");
  });

  it("renders unknown placeholders as a visible fill-in blank, never crashing", () => {
    const { text, unknown } = renderNoticeTemplate("Dear {{tenant.nam}}, {{nope.deep.path}} ok", CONTEXT);
    expect(text).toBe(`Dear ${UNKNOWN_PLACEHOLDER_MARK}, ${UNKNOWN_PLACEHOLDER_MARK} ok`);
    expect(unknown).toEqual(expect.arrayContaining(["tenant.nam", "nope.deep.path"]));
  });

  it("ignores whitespace inside braces and repeated tokens", () => {
    const { text, unknown } = renderNoticeTemplate("{{  tenant.name  }} & {{tenant.name}}", CONTEXT);
    expect(text).toBe("Eric Carrillo & Eric Carrillo");
    expect(unknown).toEqual([]);
  });

  it("never executes code: function values and prototype paths never evaluate", () => {
    const hostile = {
      tenant: { name: () => "pwned", constructor: { prototype: { polluted: "yes" } } },
    };
    const { text, missing, unknown } = renderNoticeTemplate("{{tenant.name}}|{{tenant.constructor.prototype.polluted}}", hostile);
    // tenant.name is known but a function -> missing, blanked. The deep
    // prototype walk is not a known path -> unknown, fill-in blank.
    expect(text).toBe(`|${UNKNOWN_PLACEHOLDER_MARK}`);
    expect(text).not.toContain("pwned");
    expect(text).not.toContain("yes");
    expect(missing).toEqual(expect.arrayContaining(["tenant.name"]));
    expect(unknown).toEqual(["tenant.constructor.prototype.polluted"]);
  });

  it("handles null/undefined bodies and contexts without crashing", () => {
    expect(renderNoticeTemplate(null, CONTEXT).text).toBe("");
    expect(renderNoticeTemplate("Hi {{tenant.name}}", null).missing).toContain("tenant.name");
    expect(renderNoticeTemplate(undefined, undefined).text).toBe("");
  });

  it("leaves text without placeholders untouched", () => {
    const { text, missing, unknown } = renderNoticeTemplate("Plain notice, no tokens.", CONTEXT);
    expect(text).toBe("Plain notice, no tokens.");
    expect(missing).toEqual([]);
    expect(unknown).toEqual([]);
  });
});

describe("placeholder listing", () => {
  it("splits known from unknown placeholder paths", () => {
    const { known, unknown } = listTemplatePlaceholders("{{tenant.name}} and {{custom.gate_code}} and {{bogus}}");
    expect(known).toEqual(expect.arrayContaining(["tenant.name", "custom.gate_code"]));
    expect(unknown).toEqual(["bogus"]);
  });
});

describe("HTML escaping", () => {
  it("escapes markup in values", () => {
    expect(escapeHtml("<script>alert('x')</script>")).toBe("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(escapeHtml('a & "b"')).toBe("a &amp; &quot;b&quot;");
  });

  it("converts rendered text to safe print HTML", () => {
    const hostile = "Hi <b>Eric</b>,\nPay {{tenant.name}}.";
    const { text } = renderNoticeTemplate(hostile, CONTEXT);
    const html = noticeTextToHtml(text);
    expect(html).toBe("Hi &lt;b&gt;Eric&lt;/b&gt;,<br/>Pay Eric Carrillo.");
    expect(html).not.toContain("<b>");
  });
});
