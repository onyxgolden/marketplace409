// Foundation PR B — import scoping tests (PRB-IMPORT-1, mocked db).
// A scoped import run matches/updates only packages already in that
// scope; an unscoped run keeps the legacy owner-wide match pool; a
// steps import proves its target package is in scope before any step
// is matched or created. Imports never auto-link (creates are born
// Unassigned — proven in workPackages.projectScope.test.js).
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  listPackagesForImport,
  loadImportContext,
} from "./workPackageImportApply.js";
import { SCOPE_KINDS } from "./projectScope.js";

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn(() => node),
    is: vi.fn(() => node),
    order: vi.fn(() => node),
    limit: vi.fn(() => node),
    maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

function mockDb(chains = []) {
  const queue = [...chains];
  return {
    from: vi.fn(() => {
      if (queue.length === 0) throw new Error("mockDb: from() called more times than chains queued");
      return queue.shift();
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
}

const PROJECT_SCOPE = { kind: SCOPE_KINDS.PROJECT, projectId: "forge_prj_1" };

describe("listPackagesForImport scoping", () => {
  it("a scoped run adds the project predicate to the match pool", async () => {
    const probeChain = chain({ data: [{ source_system: "maximo" }], error: null });
    const listChain = chain({ data: [], error: null });
    const db = mockDb([probeChain, listChain]);
    const result = await listPackagesForImport(db, { ownerId: "owner_1", scope: PROJECT_SCOPE });
    expect(result.packages).toEqual([]);
    expect(result.sourceTrackingAvailable).toBe(true);
    expect(listChain.eq).toHaveBeenCalledWith("forge_project_id", "forge_prj_1");
  });
  it("an unscoped run keeps the legacy owner-wide match pool", async () => {
    const probeChain = chain({ data: [{ source_system: "maximo" }], error: null });
    const listChain = chain({ data: [], error: null });
    const db = mockDb([probeChain, listChain]);
    await listPackagesForImport(db, { ownerId: "owner_1" });
    expect(listChain.eq).not.toHaveBeenCalledWith("forge_project_id", expect.anything());
    expect(listChain.eq).toHaveBeenCalledWith("owner_id", "owner_1");
  });
});

describe("loadImportContext scoping", () => {
  it("a steps import proves its target package is in scope first (guessed id = 404)", async () => {
    const pkgChain = chain({ data: null, error: null });
    const db = mockDb([pkgChain]);
    const result = await loadImportContext(db, {
      ownerId: "owner_1", kind: "steps", packageId: "forge_wp_1", scope: PROJECT_SCOPE,
    });
    expect(result).toEqual({ ok: false, httpStatus: 404, error: "Work package not found." });
    expect(db.from).toHaveBeenCalledTimes(1);
  });
  it("a scoped packages run matches only in-scope packages", async () => {
    const propsChain = chain({ data: [], error: null });
    const probeChain = chain({ data: [], error: null });
    const listChain = chain({ data: [], error: null });
    const db = mockDb([propsChain, probeChain, listChain]);
    const result = await loadImportContext(db, {
      ownerId: "owner_1", kind: "packages", scope: PROJECT_SCOPE,
    });
    expect(result.ok).toBe(true);
    expect(listChain.eq).toHaveBeenCalledWith("forge_project_id", "forge_prj_1");
  });
});
