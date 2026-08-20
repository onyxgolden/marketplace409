import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalTenantPanel, { CREATE_MODE_COPY, buildSaveTenantPayload, propertyLabelForTenant } from "./RentalTenantPanel";
import { isTenantScreeningVisible } from "./RentalTenantScreeningSection";

const leases = [
  { id: "lease_1", unit_id: "unit_1", status: "active" },
  { id: "lease_2", unit_id: "unit_2", status: "ended" },
];
const leaseMemberships = [{ lease_id: "lease_1", tenant_id: "tenant_1" }, { lease_id: "lease_2", tenant_id: "tenant_2" }];
const units = [{ id: "unit_1", label: "Main residence" }, { id: "unit_2", label: "Rear unit" }];

describe("propertyLabelForTenant", () => {
  it("resolves the unit label from the tenant's active lease", () => {
    expect(propertyLabelForTenant({ id: "tenant_1" }, leases, leaseMemberships, units)).toBe("Main residence");
  });
  it("returns null when the tenant's only lease is not active", () => {
    expect(propertyLabelForTenant({ id: "tenant_2" }, leases, leaseMemberships, units)).toBeNull();
  });
  it("returns null when the tenant has no lease membership at all", () => {
    expect(propertyLabelForTenant({ id: "tenant_3" }, leases, leaseMemberships, units)).toBeNull();
  });
  it("falls back to the raw unit id if the unit record is missing", () => {
    expect(propertyLabelForTenant({ id: "tenant_1" }, leases, leaseMemberships, [])).toBe("unit_1");
  });
});

describe("buildSaveTenantPayload", () => {
  const person = { displayName: "Jordan Applicant", email: "jordan@example.com", phone: "555-0100" };

  it("still submits status: invited for the existing tenant-creation mode", () => {
    expect(buildSaveTenantPayload("invited", person).tenant.status).toBe("invited");
  });
  it("defaults to status: invited for any unrecognized/missing mode, matching the pre-existing hardcoded default", () => {
    expect(buildSaveTenantPayload(null, person).tenant.status).toBe("invited");
    expect(buildSaveTenantPayload(undefined, person).tenant.status).toBe("invited");
    expect(buildSaveTenantPayload("something-else", person).tenant.status).toBe("invited");
  });
  it("submits status: applicant for the new applicant-creation mode", () => {
    expect(buildSaveTenantPayload("applicant", person).tenant.status).toBe("applicant");
  });
  it("submits the same operation and only the plain identity fields — no lease, charge, schedule, or active-tenant fields — for either mode", () => {
    for (const mode of ["invited", "applicant"]) {
      const payload = buildSaveTenantPayload(mode, person);
      expect(payload.operation).toBe("save-tenant");
      expect(Object.keys(payload)).toEqual(["operation", "tenant"]);
      expect(Object.keys(payload.tenant).sort()).toEqual(["displayName", "email", "phone", "status"]);
    }
  });
  it("never resolves to an already-active or already-approved status", () => {
    for (const mode of ["invited", "applicant", "anything"]) {
      expect(["invited", "applicant"]).toContain(buildSaveTenantPayload(mode, person).tenant.status);
    }
  });

  it("lets a newly created applicant reach the screening section, via the same status field both modules share", () => {
    const applicantTenant = { status: buildSaveTenantPayload("applicant", person).tenant.status };
    expect(isTenantScreeningVisible(applicantTenant)).toBe(true);
  });
  it("keeps a newly created invited tenant unable to reach the screening section", () => {
    const invitedTenant = { status: buildSaveTenantPayload("invited", person).tenant.status };
    expect(isTenantScreeningVisible(invitedTenant)).toBe(false);
  });
});

describe("CREATE_MODE_COPY", () => {
  it("clearly tells the landlord an applicant is prospective and not yet approved", () => {
    const { helpText } = CREATE_MODE_COPY.applicant;
    expect(helpText).toMatch(/prospective/i);
    expect(helpText).toMatch(/not been approved/i);
    expect(helpText).toMatch(/not signed a lease/i);
    expect(helpText).toMatch(/not moved in/i);
  });
  it("states plainly that no lease, charge, payment schedule, or portal access is created", () => {
    expect(CREATE_MODE_COPY.applicant.helpText).toMatch(/does not create a lease, a charge, a payment schedule, or portal access/i);
  });
  it("leaves the existing invited-tenant mode without any applicant-only language", () => {
    expect(CREATE_MODE_COPY.invited.helpText).toBeNull();
    expect(CREATE_MODE_COPY.invited.heading).toBe("Add a new tenant");
    expect(CREATE_MODE_COPY.invited.submitLabel).toBe("Save tenant");
  });
});

function markup(props) {
  return renderToStaticMarkup(<RentalTenantPanel initialTenants={[]} {...props} />);
}

describe("RentalTenantPanel applicant-entry markup", () => {
  it("defaults to the pre-existing invited-tenant creation form when no tenants exist yet (unchanged first-run behavior)", () => {
    const html = markup();
    expect(html).toContain("Add a new tenant");
    expect(html).toContain("Tenant name");
    expect(html).toContain("Save tenant");
    expect(html).not.toContain("Add applicant");
  });

  it("offers a distinct Add applicant action alongside the existing Add a new tenant action once tenants exist", () => {
    const html = markup({ initialTenants: [{ id: "tenant_1", display_name: "Existing Tenant", email: "existing@example.com", status: "active" }] });
    expect(html).toContain("+ Add a new tenant");
    expect(html).toContain("+ Add applicant");
  });

  it("shows the prospective-applicant help text and applicant-labeled field only in applicant mode", () => {
    const html = renderToStaticMarkup(<RentalTenantPanel initialTenants={[{ id: "tenant_1", display_name: "Existing Tenant", email: "existing@example.com", status: "active" }]} initialCreateMode="applicant" />);
    expect(html).toContain("Add a rental applicant");
    expect(html).toContain("Applicant name");
    expect(html).toContain("Save applicant");
    expect(html).toMatch(/prospective only/);
    expect(html).toContain('data-create-mode="applicant"');
  });

  function applicantCreateFormMarkup() {
    const html = renderToStaticMarkup(<RentalTenantPanel initialTenants={[{ id: "tenant_1", display_name: "Existing Tenant", email: "existing@example.com", status: "active" }]} initialCreateMode="applicant" />);
    // Scope to just the applicant create-form fragment — the page also renders the unrelated,
    // pre-existing "Update portal email" form for the already-selected tenant above it.
    return html.slice(html.indexOf("data-rental-tenant-create-form"));
  }
  function inputTag(formHtml, name) {
    return [...formHtml.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(`name="${name}"`));
  }

  it("collects only name, email, and phone in applicant mode — no SSN, date of birth, credit, or criminal fields", () => {
    const formHtml = applicantCreateFormMarkup();
    const inputNames = [...formHtml.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
    expect(inputNames.sort()).toEqual(["displayName", "email", "phone"]);
    expect(formHtml).not.toMatch(/ssn|social.security|date.of.birth|credit.score|criminal/i);
  });

  it("keeps the existing required-field validation rules unchanged in applicant mode too", () => {
    const formHtml = applicantCreateFormMarkup();
    expect(inputTag(formHtml, "displayName")).toMatch(/\brequired(="")?/);
    expect(inputTag(formHtml, "email")).toMatch(/\brequired(="")?/);
    expect(inputTag(formHtml, "phone")).not.toMatch(/\brequired(="")?/);
  });

  it("never introduces an automatic approve/deny/decision action on the applicant form", () => {
    const html = renderToStaticMarkup(<RentalTenantPanel initialTenants={[{ id: "tenant_1", display_name: "Existing Tenant", email: "existing@example.com", status: "active" }]} initialCreateMode="applicant" />);
    expect(html).not.toMatch(/>approve</i);
    expect(html).not.toMatch(/>deny</i);
  });
});
