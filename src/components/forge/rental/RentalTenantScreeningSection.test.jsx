import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalTenantScreeningSection, {
  SCREENING_STATUS_OPTIONS,
  buildScreeningRedirectHref,
  isTenantScreeningVisible,
  loadScreeningTracker,
  saveScreeningTracker,
  screeningDisclosureCopy,
  screeningTrackerStorageKey,
} from "./RentalTenantScreeningSection";

const tenant = { id: "tenant_1", display_name: "Jordan Applicant", status: "applicant" };

function markup(props) {
  return renderToStaticMarkup(<RentalTenantScreeningSection tenant={tenant} initialConfig={{ smartMove: { affiliateActive: false } }} {...props} />);
}

describe("isTenantScreeningVisible", () => {
  it("is visible only for an applicant-status record", () => {
    expect(isTenantScreeningVisible({ status: "applicant" })).toBe(true);
  });
  it("is hidden for every other tenant lifecycle status", () => {
    for (const status of ["invited", "active", "former", "inactive"]) {
      expect(isTenantScreeningVisible({ status })).toBe(false);
    }
  });
  it("is hidden for a missing tenant or missing status", () => {
    expect(isTenantScreeningVisible(null)).toBe(false);
    expect(isTenantScreeningVisible(undefined)).toBe(false);
    expect(isTenantScreeningVisible({})).toBe(false);
  });
});

describe("buildScreeningRedirectHref", () => {
  it("points at the provider-neutral redirect route with only a provider key", () => {
    expect(buildScreeningRedirectHref("smartmove")).toBe("/api/rental/screening/redirect?provider=smartmove");
  });
});

describe("screeningDisclosureCopy", () => {
  it("always includes the privacy disclosure", () => {
    expect(screeningDisclosureCopy({ affiliateActive: false }).privacy).toMatch(/does not receive or store your Social Security number/);
    expect(screeningDisclosureCopy({ affiliateActive: true }).privacy).toMatch(/does not receive or store your Social Security number/);
  });
  it("includes a commission disclosure only when affiliate mode is active", () => {
    expect(screeningDisclosureCopy({ affiliateActive: false }).commission).toBeNull();
    expect(screeningDisclosureCopy({ affiliateActive: true }).commission).toMatch(/may receive a commission/);
  });
});

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
    _data: data,
  };
}

describe("screening tracker persistence (browser-local only, no server persistence)", () => {
  it("defaults to not_requested / smartmove when nothing is stored", () => {
    expect(loadScreeningTracker("tenant_1", fakeStorage())).toEqual({ status: "not_requested", providerChoice: "smartmove", otherProviderName: "" });
  });
  it("round-trips a saved status", () => {
    const storage = fakeStorage();
    saveScreeningTracker("tenant_1", { status: "report_ready", providerChoice: "smartmove", otherProviderName: "" }, storage);
    expect(loadScreeningTracker("tenant_1", storage).status).toBe("report_ready");
    expect(storage._data[screeningTrackerStorageKey("tenant_1")]).toBeTruthy();
  });
  it("never throws and falls back to defaults on corrupted storage", () => {
    const storage = fakeStorage({ [screeningTrackerStorageKey("tenant_1")]: "{not json" });
    expect(loadScreeningTracker("tenant_1", storage)).toEqual({ status: "not_requested", providerChoice: "smartmove", otherProviderName: "" });
  });
  it("is a no-op without throwing when no storage is available (SSR)", () => {
    expect(() => saveScreeningTracker("tenant_1", { status: "reviewed" }, null)).not.toThrow();
    expect(loadScreeningTracker("tenant_1", null)).toEqual({ status: "not_requested", providerChoice: "smartmove", otherProviderName: "" });
  });

  it("scopes storage to one stable tenant id — never leaks one record's status onto another", () => {
    const storage = fakeStorage();
    saveScreeningTracker("tenant_1", { status: "report_ready", providerChoice: "smartmove", otherProviderName: "" }, storage);
    saveScreeningTracker("tenant_2", { status: "cancelled", providerChoice: "other", otherProviderName: "CIC" }, storage);
    expect(loadScreeningTracker("tenant_1", storage).status).toBe("report_ready");
    expect(loadScreeningTracker("tenant_2", storage).status).toBe("cancelled");
    // Selecting a third, never-saved record must not pick up either sibling's state.
    expect(loadScreeningTracker("tenant_3", storage)).toEqual({ status: "not_requested", providerChoice: "smartmove", otherProviderName: "" });
  });

  it("uses distinct, non-colliding storage keys per tenant id", () => {
    expect(screeningTrackerStorageKey("tenant_1")).not.toBe(screeningTrackerStorageKey("tenant_2"));
  });
});

describe("SCREENING_STATUS_OPTIONS", () => {
  it("matches the seven manual operational statuses, with no approve/deny value", () => {
    expect(SCREENING_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      "not_requested", "invitation_sent", "applicant_completing", "report_ready", "reviewed", "decision_completed", "cancelled",
    ]);
    const values = SCREENING_STATUS_OPTIONS.map((option) => option.value).join(" ");
    expect(values).not.toMatch(/approved|denied|rejected|accept/);
  });
});

describe("RentalTenantScreeningSection markup", () => {
  it("shows the recommended SmartMove action with its required labels", () => {
    const html = markup();
    expect(html).toContain("Start SmartMove screening");
    expect(html).toContain('href="/api/rental/screening/redirect?provider=smartmove"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Recommended");
    expect(html).toContain("Operated by TransUnion");
    expect(html).toContain("Applicant-authorized");
    expect(html).toContain("External to FORGE");
  });

  it("always shows the privacy disclosure", () => {
    expect(markup()).toContain("FORGE does not receive or store your Social Security number or screening report through this link.");
  });

  it("shows the commission disclosure only when affiliate mode is active", () => {
    expect(markup({ initialConfig: { smartMove: { affiliateActive: false } } })).not.toContain("FORGE may receive a commission");
    expect(markup({ initialConfig: { smartMove: { affiliateActive: true } } })).toContain("FORGE may receive a commission when screening is purchased through this link. This does not increase the screening price.");
  });

  it("includes the jurisdiction/coverage reminder and never claims SmartMove catches every record", () => {
    const html = markup();
    expect(html).toContain("Report availability and record coverage vary by jurisdiction");
    expect(html).not.toMatch(/catches every record|guarantees every record|complete criminal history|every record/i);
  });

  it("never claims FORGE performs, guarantees, or receives the background check", () => {
    const html = markup();
    expect(html).toContain("FORGE does not perform, guarantee, or receive the results of this background check.");
    expect(html).not.toMatch(/FORGE performs|FORGE guarantees|FORGE conducts/i);
  });

  it("never claims a partnership or endorsement", () => {
    expect(markup()).not.toMatch(/partner(ship)?|endorse(d|s|ment)?/i);
  });

  it("keeps the 'use another screening provider' option available and provider-agnostic", () => {
    expect(markup()).toContain("Use another screening provider");
  });

  it("never introduces an approve/deny action", () => {
    const html = markup();
    expect(html).not.toMatch(/>approve</i);
    expect(html).not.toMatch(/>deny</i);
  });

  it("collects no SSN, date of birth, credit, or criminal fields, and forwards nothing but a provider key", () => {
    const html = markup();
    expect(html).not.toMatch(/name="ssn"|name="socialSecurityNumber"|name="dob"|name="dateOfBirth"|name="creditScore"|name="criminalHistory"|type="password"/i);
    expect(html.match(/<input/g) || []).toHaveLength(0); // the "other provider name" field is hidden until selected
  });

  it("renders with dark-mode variants present (theme support)", () => {
    const html = markup();
    expect(html).toMatch(/dark:bg-slate-900/);
    expect(html).toMatch(/dark:text-slate-100/);
  });
});

describe("RentalTenantScreeningSection lifecycle-status gating", () => {
  it("renders nothing at all for active, former, invited, or inactive tenants", () => {
    for (const status of ["invited", "active", "former", "inactive"]) {
      const html = renderToStaticMarkup(
        <RentalTenantScreeningSection tenant={{ id: "tenant_1", display_name: "Jordan", status }} initialConfig={{ smartMove: { affiliateActive: false } }} />,
      );
      expect(html).toBe("");
    }
  });

  it("renders the full section for an applicant-status tenant", () => {
    const html = renderToStaticMarkup(
      <RentalTenantScreeningSection tenant={{ id: "tenant_1", display_name: "Jordan", status: "applicant" }} initialConfig={{ smartMove: { affiliateActive: false } }} />,
    );
    expect(html).toContain("Start SmartMove screening");
    expect(html).toContain("Tenant Screening");
  });

  it("renders nothing for a tenant with no status recorded at all", () => {
    const html = renderToStaticMarkup(
      <RentalTenantScreeningSection tenant={{ id: "tenant_1", display_name: "Jordan" }} initialConfig={{ smartMove: { affiliateActive: false } }} />,
    );
    expect(html).toBe("");
  });
});
