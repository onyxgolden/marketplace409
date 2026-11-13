// FORGE shared hierarchy — domain rules (pure, no I/O).

import { describe, expect, it } from "vitest";
import {
  applyClientSelection,
  applyProjectSelection,
  applySiteSelection,
  clearInvalidSelection,
  countTree,
  emptySelection,
  findProjectInTree,
  normalizeName,
  validateClientInput,
  validateProjectInput,
  validateSiteInput,
} from "./hierarchy.js";

describe("normalizeName", () => {
  it("trims and lowercases, matching the database generated column", () => {
    expect(normalizeName("  Acme Industrial ")).toBe("acme industrial");
    expect(normalizeName(null)).toBe("");
  });
});

describe("validateClientInput", () => {
  it("accepts a full valid payload", () => {
    expect(
      validateClientInput({ name: "Acme", externalReference: "ACME-1", notes: "Hi", status: "active" }),
    ).toBeNull();
  });

  it("rejects a blank name and an over-long name", () => {
    expect(validateClientInput({ name: "   " }).code).toBe("INVALID_NAME");
    expect(validateClientInput({ name: "x".repeat(201) }).code).toBe("INVALID_NAME");
  });

  it("rejects control characters in the name", () => {
    expect(validateClientInput({ name: "Acme\u0007" }).code).toBe("INVALID_NAME");
  });

  it("rejects an unknown status", () => {
    expect(validateClientInput({ name: "Acme", status: "deleted" }).code).toBe("INVALID_STATUS");
  });

  it("allows null/empty optionals (unchanged/clear on update)", () => {
    expect(validateClientInput({ name: "Acme", externalReference: "", notes: null })).toBeNull();
  });
});

describe("validateSiteInput", () => {
  it("accepts a full valid payload", () => {
    expect(
      validateSiteInput({
        name: "Plant 1",
        siteType: "industrial",
        addressLine1: "1 Main St",
        city: "Beaumont",
        region: "TX",
        postalCode: "77701",
        countryCode: "US",
        status: "active",
      }),
    ).toBeNull();
  });

  it("rejects an unknown site type and a bad country code", () => {
    expect(validateSiteInput({ name: "Plant 1", siteType: "orbital" }).code).toBe(
      "INVALID_SITE_TYPE",
    );
    expect(validateSiteInput({ name: "Plant 1", countryCode: "USA" }).code).toBe(
      "INVALID_COUNTRY_CODE",
    );
    expect(validateSiteInput({ name: "Plant 1", countryCode: "us" })).toBeNull();
  });

  it("rejects an over-long city", () => {
    expect(validateSiteInput({ name: "Plant 1", city: "x".repeat(121) }).code).toBe(
      "INVALID_ADDRESS",
    );
  });
});

describe("validateProjectInput", () => {
  it("accepts a full valid payload", () => {
    expect(
      validateProjectInput({
        name: "Turnaround 2027",
        projectCode: "TA-27",
        description: "Spring turnaround",
        projectType: "turnaround",
        plannedStart: "2027-03-01",
        plannedFinish: "2027-04-15",
        status: "planned",
      }),
    ).toBeNull();
  });

  it("rejects a bad date, an impossible date, and finish before start", () => {
    expect(validateProjectInput({ name: "P", plannedStart: "03/01/2027" }).code).toBe(
      "INVALID_DATE",
    );
    expect(validateProjectInput({ name: "P", plannedStart: "2027-02-30" }).code).toBe(
      "INVALID_DATE",
    );
    expect(
      validateProjectInput({ name: "P", plannedStart: "2027-04-15", plannedFinish: "2027-03-01" })
        .code,
    ).toBe("INVALID_DATES");
  });

  it("rejects an unknown project status", () => {
    expect(validateProjectInput({ name: "P", status: "deleted" }).code).toBe("INVALID_STATUS");
  });
});

describe("selector state transitions", () => {
  it("changing client clears site and project in one transaction", () => {
    const before = { clientId: "c1", siteId: "s1", projectId: "p1" };
    expect(applyClientSelection(before, "c2")).toEqual({
      clientId: "c2",
      siteId: null,
      projectId: null,
    });
    expect(applyClientSelection(before, null)).toEqual({
      clientId: null,
      siteId: null,
      projectId: null,
    });
  });

  it("changing site clears project but keeps the client", () => {
    const before = { clientId: "c1", siteId: "s1", projectId: "p1" };
    expect(applySiteSelection(before, "s2")).toEqual({
      clientId: "c1",
      siteId: "s2",
      projectId: null,
    });
  });

  it("changing project keeps client and site", () => {
    const before = { clientId: "c1", siteId: "s1", projectId: "p1" };
    expect(applyProjectSelection(before, "p2")).toEqual({
      clientId: "c1",
      siteId: "s1",
      projectId: "p2",
    });
  });

  it("clearing an invalid selection empties it and names what was cleared", () => {
    const { selection, cleared } = clearInvalidSelection({
      clientId: "c1",
      siteId: "s1",
      projectId: "p1",
    });
    expect(selection).toEqual(emptySelection());
    expect(cleared).toEqual(["project", "site", "client"]);
  });
});

describe("findProjectInTree / countTree", () => {
  const tree = {
    clients: [
      {
        id: "c1",
        name: "Acme",
        sites: [
          {
            id: "s1",
            name: "Plant 1",
            projects: [
              { id: "p1", name: "TA 27" },
              { id: "p2", name: "TA 28" },
            ],
          },
        ],
      },
      { id: "c2", name: "Beta", sites: [] },
    ],
  };

  it("resolves a project to its client and site through the chain", () => {
    const found = findProjectInTree(tree, "p2");
    expect(found.client.id).toBe("c1");
    expect(found.site.id).toBe("s1");
    expect(found.project.id).toBe("p2");
    expect(findProjectInTree(tree, "p-nope")).toBeNull();
  });

  it("counts the tree", () => {
    expect(countTree(tree)).toEqual({ clients: 2, sites: 1, projects: 2 });
  });
});
