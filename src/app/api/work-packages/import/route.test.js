import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/workPackageImportApply", () => ({
  loadImportContext: vi.fn(),
  applyWorkPackageImport: vi.fn(),
}));
vi.mock("@/application/work-management/projectScope", () => ({
  SCOPE_KINDS: { PROJECT: "project", UNASSIGNED: "unassigned", NONE: "none" },
  provePackageInScope: vi.fn(),
}));

import { workAuth } from "../_lib/auth.js";
import { loadImportContext, applyWorkPackageImport } from "@/application/work-management/workPackageImportApply";
import { provePackageInScope } from "@/application/work-management/projectScope";
import { POST as previewPost, parseImportFile } from "./preview/route.js";
import { POST as confirmPost } from "./confirm/route.js";
import { GET as templateGet } from "./template/route.js";

const AUTH = { db: {}, ownerId: "owner_1", actor: "user_9", scope: { kind: "unassigned" } };
const CONTEXT = {
  ok: true,
  existingPackages: [],
  existingSteps: [],
  sourceTrackingAvailable: false,
  properties: [{ slug: "4800-kent-ave", label: "4800 Kent Ave" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  loadImportContext.mockResolvedValue(CONTEXT);
  provePackageInScope.mockResolvedValue({ ok: true, package: { id: "forge_wp_1" } });
});

function previewRequest({ kind = "packages", csv, filename = "import.csv", sourceSystem, mapping, packageId, forgeProject = "unassigned" }) {
  const form = new FormData();
  form.append("file", new File([csv], filename, { type: "text/csv" }));
  form.append("kind", kind);
  if (packageId) form.append("packageId", packageId);
  if (sourceSystem) form.append("sourceSystem", sourceSystem);
  if (mapping) form.append("mapping", JSON.stringify(mapping));
  const query = forgeProject === null ? "" : `?forgeProject=${encodeURIComponent(forgeProject)}`;
  return new Request(`https://test/api/work-packages/import/preview${query}`, { method: "POST", body: form });
}

describe("parseImportFile", () => {
  it("parses CSV and TSV text", async () => {
    const csv = await parseImportFile(Buffer.from("Title,Status\nKitchen,draft\n"), "import.csv");
    expect(csv.headers).toEqual(["Title", "Status"]);
    expect(csv.rows).toEqual([["Kitchen", "draft"]]);
    const tsv = await parseImportFile(Buffer.from("Title\tCraft\nPipe\tPipefitter\n"), "import.tsv");
    expect(tsv.headers).toEqual(["Title", "Craft"]);
  });

  it("rejects an unsupported extension", async () => {
    await expect(parseImportFile(Buffer.from("x"), "import.pdf")).rejects.toThrow("Import .xlsx");
  });
});

describe("POST /api/work-packages/import/preview", () => {
  it("plans creates from a CSV and returns the mapping", async () => {
    const response = await previewPost(previewRequest({
      csv: "Title,Status,Property\nKent kitchen,draft,4800 Kent Ave\n",
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.plan.summary).toEqual({ createCount: 1, updateCount: 0, errorCount: 0 });
    expect(body.plan.creates[0].fields).toMatchObject({
      title: "Kent kitchen", propertyId: "4800-kent-ave",
    });
    expect(body.columns.find((c) => c.header === "Title").fieldKey).toBe("title");
    expect(body.sourceTrackingAvailable).toBe(false);
  });

  it("flags plan errors in the preview instead of writing anything", async () => {
    const response = await previewPost(previewRequest({
      csv: "Title,Status\nBad one,flying\n",
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.plan.errors[0].message).toContain('Status "flying"');
  });

  it("requires a packageId for step imports", async () => {
    const response = await previewPost(previewRequest({
      kind: "steps",
      csv: "Title\nFabricate\n",
    }));
    expect(response.status).toBe(400);
  });

  it("applies a manual column remap on re-preview", async () => {
    const response = await previewPost(previewRequest({
      csv: "Name,State\nKent kitchen,draft\n",
      mapping: ["title", "status"],
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.plan.summary.createCount).toBe(1);
    expect(body.plan.creates[0].fields.title).toBe("Kent kitchen");
  });

  it("rejects an unknown source system", async () => {
    const response = await previewPost(previewRequest({
      csv: "Title\nKent kitchen\n",
      sourceSystem: "oracle",
    }));
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    workAuth.mockResolvedValueOnce({ error: Response.json({ error: "no" }, { status: 401 }) });
    const response = await previewPost(previewRequest({ csv: "Title\nKent kitchen\n" }));
    expect(response.status).toBe(401);
  });

  // Fix round 1 (PR #799 P1): an import preview requires an explicit
  // PROJECT or UNASSIGNED scope. An omitted/blank/malformed
  // forgeProject resolves to NO_SCOPE (or a scope error) in workAuth,
  // and the route refuses the run with 400 before any matching —
  // no owner-wide match pool, no rows planned from other projects.
  it("refuses a preview with no scope (omitted forgeProject) before matching", async () => {
    workAuth.mockResolvedValueOnce({ ...AUTH, scope: { kind: "none" } });
    const response = await previewPost(previewRequest({
      csv: "Title,Status\nKent kitchen,draft\n", forgeProject: null,
    }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Choose a project/);
    expect(loadImportContext).not.toHaveBeenCalled();
  });
  it("refuses a preview with a blank forgeProject (NO_SCOPE) before matching", async () => {
    workAuth.mockResolvedValueOnce({ ...AUTH, scope: { kind: "none" } });
    const response = await previewPost(previewRequest({
      csv: "Title,Status\nKent kitchen,draft\n", forgeProject: "",
    }));
    expect(response.status).toBe(400);
    expect(loadImportContext).not.toHaveBeenCalled();
  });
  it("refuses a preview with a malformed forgeProject via the scope error", async () => {
    workAuth.mockResolvedValueOnce({
      ...AUTH, scopeError: { ok: false, httpStatus: 400, error: "That project link is not valid." },
    });
    const response = await previewPost(previewRequest({
      csv: "Title,Status\nKent kitchen,draft\n", forgeProject: "not-a-project",
    }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/not valid/);
    expect(loadImportContext).not.toHaveBeenCalled();
  });
  it("passes the explicit scope to the import context", async () => {
    const response = await previewPost(previewRequest({
      csv: "Title,Status\nKent kitchen,draft\n",
    }));
    expect(response.status).toBe(200);
    expect(loadImportContext).toHaveBeenCalledWith({}, expect.objectContaining({
      ownerId: "owner_1", scope: { kind: "unassigned" },
    }));
  });
});

describe("POST /api/work-packages/import/confirm", () => {
  function confirmRequest(body, forgeProject = "unassigned") {
    const query = forgeProject === null ? "" : `?forgeProject=${encodeURIComponent(forgeProject)}`;
    return new Request(`https://test/api/work-packages/import/confirm${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("applies a clean plan and reports the tally", async () => {
    applyWorkPackageImport.mockResolvedValue({
      created: [{ rowIndex: 0, package: { id: "wp_new", code: "WP-0007" } }],
      updated: [],
      warnings: [],
      errors: [],
    });
    const response = await confirmPost(confirmRequest({
      kind: "packages",
      rows: [{ title: "Kent kitchen", status: "draft" }],
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.summary).toEqual({ created: 1, updated: 0, warnings: 0, errors: 0 });
    expect(applyWorkPackageImport).toHaveBeenCalledWith({}, expect.objectContaining({
      ownerId: "owner_1", actor: "user_9", kind: "packages",
    }));
  });

  it("refuses a plan that no longer validates instead of applying it", async () => {
    applyWorkPackageImport.mockResolvedValue({ created: [], updated: [], warnings: [], errors: [] });
    const response = await confirmPost(confirmRequest({
      kind: "packages",
      rows: [{ title: "Bad one", status: "flying" }],
    }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.errors[0].message).toContain('Status "flying"');
    expect(applyWorkPackageImport).not.toHaveBeenCalled();
  });

  // Fix round 1 (PR #799 P1): confirm requires the same explicit
  // scope as preview, and a step import re-proves the target
  // package's membership in that scope right before applying — a
  // package that left the scope since the preview gets no steps.
  it("refuses a confirm with no scope (omitted forgeProject) before matching or applying", async () => {
    workAuth.mockResolvedValueOnce({ ...AUTH, scope: { kind: "none" } });
    const response = await confirmPost(confirmRequest({
      kind: "packages",
      rows: [{ title: "Kent kitchen", status: "draft" }],
    }, null));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Choose a project/);
    expect(loadImportContext).not.toHaveBeenCalled();
    expect(applyWorkPackageImport).not.toHaveBeenCalled();
  });
  it("proves a step import's target package is in scope right before applying", async () => {
    applyWorkPackageImport.mockResolvedValue({ created: [], updated: [], warnings: [], errors: [] });
    const response = await confirmPost(confirmRequest({
      kind: "steps",
      packageId: "forge_wp_1",
      rows: [{ title: "Fabricate" }],
    }));
    expect(response.status).toBe(200);
    expect(provePackageInScope).toHaveBeenCalledWith({}, expect.objectContaining({
      ownerId: "owner_1", packageId: "forge_wp_1", scope: { kind: "unassigned" },
    }));
    expect(applyWorkPackageImport).toHaveBeenCalled();
  });
  it("refuses a step import whose target left the scope (404), applying nothing", async () => {
    provePackageInScope.mockResolvedValueOnce({ ok: false, httpStatus: 404, error: "Work package not found." });
    const response = await confirmPost(confirmRequest({
      kind: "steps",
      packageId: "forge_wp_1",
      rows: [{ title: "Fabricate" }],
    }));
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error).toBe("Work package not found.");
    expect(applyWorkPackageImport).not.toHaveBeenCalled();
  });
});

describe("GET /api/work-packages/import/template", () => {
  // The package template is mode-aware (Industrial / Commercial mode
  // selector): with no ?mode=, it defaults to Industrial — the
  // planner's primary purpose, same default as a newly created
  // package — not the old hardcoded real-estate example.
  it("returns the package template CSV, Industrial example by default", async () => {
    const response = await templateGet(new Request("https://test/api/work-packages/import/template?kind=packages"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    const text = await response.text();
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("Title,Package #,Status,Property,Scope,Planned start,Planned finish,Description,Source record ID");
    expect(text).toContain("Fabricate pipe spool");
    expect(text).not.toContain("Kitchen remodel");
    // The example row has one field per header column (I4 alignment
    // fix) — Package # (col 2) and Property (col 4) are both blank for
    // the industrial example, so a naive split must still yield 9 cells.
    const exampleCells = lines[1].split(",");
    expect(exampleCells).toHaveLength(9);
  });

  it("returns the Commercial example row with ?mode=commercial, correctly aligned", async () => {
    const response = await templateGet(new Request("https://test/api/work-packages/import/template?kind=packages&mode=commercial"));
    const text = await response.text();
    const lines = text.trim().split("\n");
    expect(text).toContain("Kitchen remodel");
    expect(text).not.toContain("Fabricate pipe spool");
    const exampleCells = lines[1].split(",");
    expect(exampleCells).toHaveLength(9);
    // I4: the live column order is Title, Package #, Status, Property,
    // Scope, Planned start, Planned finish, Description, Source record
    // ID — the pre-fix row had Status in the Package # slot and so on.
    expect(exampleCells[0]).toBe("Kitchen remodel"); // Title
    expect(exampleCells[1]).toBe(""); // Package # — server-assigned, never imported
    expect(exampleCells[2]).toBe("draft"); // Status
    expect(exampleCells[3]).toBe("4800 Kent Ave"); // Property
    expect(exampleCells[4]).toBe("remodel"); // Scope
  });

  it("an unrecognized ?mode= value falls back to Industrial rather than erroring", async () => {
    const response = await templateGet(new Request("https://test/api/work-packages/import/template?kind=packages&mode=residential"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Fabricate pipe spool");
  });

  it("mode has no effect on the steps template — identical in both modes", async () => {
    const industrial = await (await templateGet(new Request("https://test/api/work-packages/import/template?kind=steps&mode=industrial"))).text();
    const commercial = await (await templateGet(new Request("https://test/api/work-packages/import/template?kind=steps&mode=commercial"))).text();
    expect(industrial).toBe(commercial);
  });

  it("returns the step template CSV", async () => {
    const response = await templateGet(new Request("https://test/api/work-packages/import/template?kind=steps"));
    const text = await response.text();
    expect(text.split("\n")[0]).toContain("Step #,Title,Description,Craft");
    expect(text).toContain("Fabricate pipe spool");
  });

  it("rejects an unknown kind", async () => {
    const response = await templateGet(new Request("https://test/api/work-packages/import/template?kind=drawings"));
    expect(response.status).toBe(400);
  });
});
