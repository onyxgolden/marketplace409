import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./workPackages.js", () => ({
  createWorkPackage: vi.fn(),
  updateWorkPackage: vi.fn(),
  transitionWorkPackage: vi.fn(),
  listPackagePropertyOptions: vi.fn(),
}));
vi.mock("./workSteps.js", () => ({
  createWorkStep: vi.fn(),
  updateWorkStep: vi.fn(),
  listWorkSteps: vi.fn(),
}));

import {
  applyWorkPackageImport,
  probeSourceTracking,
  listPackagesForImport,
} from "./workPackageImportApply.js";
import {
  createWorkPackage,
  updateWorkPackage,
  transitionWorkPackage,
} from "./workPackages.js";
import { createWorkStep, updateWorkStep } from "./workSteps.js";

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), limit: vi.fn(() => node),
    update: vi.fn(() => node),
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
  };
}

// A db whose only write path is db.rpc: any direct table write throws,
// so a test using it proves the apply layer stamps through the RPC
// and never writes forge_work_steps directly (authenticated has
// SELECT only on that table in production — a direct UPDATE is
// denied, which is exactly the P1 this fix round closes).
function rpcDb(rpcResult = { data: null, error: null }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
    from: vi.fn(() => { throw new Error("apply must not write tables directly"); }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("probeSourceTracking / listPackagesForImport", () => {
  it("reports tracking available when the probe column reads cleanly", async () => {
    const probe = chain({ data: [], error: null });
    const list = chain({ data: [{ id: "wp_1", code: "WP-0001" }], error: null });
    const db = mockDb([probe, list]);
    const result = await listPackagesForImport(db, { ownerId: "owner_1" });
    expect(result.sourceTrackingAvailable).toBe(true);
    expect(result.packages).toHaveLength(1);
    expect(list.select).toHaveBeenCalledWith(expect.stringContaining("source_system"));
  });

  it("falls back to plain columns when the migration has not applied", async () => {
    const probe = chain({ data: null, error: { code: "42703", message: 'column "source_system" does not exist' } });
    const list = chain({ data: [{ id: "wp_1", code: "WP-0001" }], error: null });
    const db = mockDb([probe, list]);
    const result = await listPackagesForImport(db, { ownerId: "owner_1" });
    expect(result.sourceTrackingAvailable).toBe(false);
    expect(list.select).toHaveBeenCalledWith("id, code, title, status");
  });

  it("throws a real probe error instead of silently degrading", async () => {
    const probe = chain({ data: null, error: { code: "42501", message: "permission denied" } });
    const db = mockDb([probe]);
    await expect(probeSourceTracking(db, "owner_1")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("applyWorkPackageImport — packages", () => {
  it("creates packages through the existing service and transitions a carried status", async () => {
    createWorkPackage.mockResolvedValue({
      ok: true,
      package: { id: "wp_new", code: "WP-0007", title: "Kent kitchen", status: "draft" },
    });
    transitionWorkPackage.mockResolvedValue({
      ok: true,
      package: { id: "wp_new", code: "WP-0007", title: "Kent kitchen", status: "planned" },
    });
    const plan = {
      creates: [{
        rowIndex: 0,
        fields: { title: "Kent kitchen", packageType: "remodel", propertyId: "4800-kent-ave" },
        statusTarget: "planned",
      }],
      updates: [],
    };
    const results = await applyWorkPackageImport({}, {
      ownerId: "owner_1", actor: "user_9", kind: "packages", plan,
      sourceSystem: null, sourceTrackingAvailable: false,
    });
    expect(results.errors).toHaveLength(0);
    expect(results.created).toHaveLength(1);
    expect(results.created[0].package.status).toBe("planned");
    expect(createWorkPackage).toHaveBeenCalledWith({}, expect.objectContaining({
      ownerId: "owner_1", actor: "user_9",
      input: expect.objectContaining({ title: "Kent kitchen", package_type: "remodel", property_id: "4800-kent-ave" }),
    }));
    expect(transitionWorkPackage).toHaveBeenCalledWith({}, expect.objectContaining({
      packageId: "wp_new", to: "planned",
    }));
  });

  it("warns instead of failing the row when the lifecycle refuses the status move", async () => {
    createWorkPackage.mockResolvedValue({
      ok: true,
      package: { id: "wp_new", code: "WP-0007", title: "Kent kitchen", status: "draft" },
    });
    transitionWorkPackage.mockResolvedValue({ ok: false, httpStatus: 409, error: "Cannot move from draft to ready." });
    const plan = {
      creates: [{ rowIndex: 0, fields: { title: "Kent kitchen" }, statusTarget: "ready" }],
      updates: [],
    };
    const results = await applyWorkPackageImport({}, {
      ownerId: "owner_1", actor: "user_9", kind: "packages", plan,
      sourceSystem: null, sourceTrackingAvailable: false,
    });
    expect(results.created).toHaveLength(1);
    expect(results.warnings).toHaveLength(1);
    expect(results.warnings[0].message).toContain("WP-0007 was created");
    expect(results.errors).toHaveLength(0);
  });

  it("stamps the source pair on create only when tracking is available", async () => {
    createWorkPackage.mockResolvedValue({
      ok: true,
      package: { id: "wp_new", code: "WP-0007", title: "SAP job", status: "draft" },
    });
    const plan = {
      creates: [{ rowIndex: 0, fields: { title: "SAP job", sourceRecordId: "1002345" }, statusTarget: null }],
      updates: [],
    };
    await applyWorkPackageImport({}, {
      ownerId: "owner_1", actor: "user_9", kind: "packages", plan,
      sourceSystem: "sap", sourceTrackingAvailable: true,
    });
    expect(createWorkPackage).toHaveBeenCalledWith({}, expect.objectContaining({
      input: expect.objectContaining({ source_system: "sap", source_record_id: "1002345" }),
    }));
  });

  it("does not send source fields before the migration applies", async () => {
    createWorkPackage.mockResolvedValue({
      ok: true,
      package: { id: "wp_new", code: "WP-0007", title: "SAP job", status: "draft" },
    });
    const plan = {
      creates: [{ rowIndex: 0, fields: { title: "SAP job", sourceRecordId: "1002345" }, statusTarget: null }],
      updates: [],
    };
    await applyWorkPackageImport({}, {
      ownerId: "owner_1", actor: "user_9", kind: "packages", plan,
      sourceSystem: "sap", sourceTrackingAvailable: false,
    });
    const input = createWorkPackage.mock.calls[0][1].input;
    expect(input).not.toHaveProperty("source_system");
    expect(input).not.toHaveProperty("source_record_id");
  });

  it("skips a no-change update instead of bumping the package", async () => {
    updateWorkPackage.mockResolvedValue({ ok: true, package: { id: "wp_1", code: "WP-0001" } });
    const current = {
      id: "wp_1", code: "WP-0001", title: "Kent kitchen", status: "draft",
      package_type: "remodel", property_id: "4800-kent-ave",
      planned_start: "2026-11-10", planned_finish: null, description: null,
      source_system: null, source_record_id: null,
    };
    const plan = {
      creates: [],
      updates: [{
        rowIndex: 0, id: "wp_1", matchKind: "title",
        fields: { title: "Kent kitchen", packageType: "remodel", propertyId: "4800-kent-ave", plannedStart: "2026-11-10" },
        statusTarget: null, version: 3, current,
      }],
    };
    const results = await applyWorkPackageImport({}, {
      ownerId: "owner_1", actor: "user_9", kind: "packages", plan,
      sourceSystem: null, sourceTrackingAvailable: false,
    });
    expect(results.updated).toHaveLength(1);
    expect(updateWorkPackage).not.toHaveBeenCalled();
    expect(transitionWorkPackage).not.toHaveBeenCalled();
  });

  it("reports a failed row and keeps applying the rest", async () => {
    createWorkPackage
      .mockResolvedValueOnce({ ok: false, httpStatus: 400, error: "title is required and must be non-blank." })
      .mockResolvedValueOnce({
        ok: true,
        package: { id: "wp_2", code: "WP-0008", title: "Second", status: "draft" },
      });
    const plan = {
      creates: [
        { rowIndex: 0, fields: { title: "Bad" }, statusTarget: null },
        { rowIndex: 1, fields: { title: "Second" }, statusTarget: null },
      ],
      updates: [],
    };
    const results = await applyWorkPackageImport({}, {
      ownerId: "owner_1", actor: "user_9", kind: "packages", plan,
      sourceSystem: null, sourceTrackingAvailable: false,
    });
    expect(results.created).toHaveLength(1);
    expect(results.errors).toHaveLength(1);
    expect(results.errors[0].rowIndex).toBe(0);
  });
});

describe("applyWorkPackageImport — steps", () => {
  it("creates a step at the file's position and stamps its source record through the RPC", async () => {
    createWorkStep.mockResolvedValue({
      ok: true,
      step: { id: "s_new", sequenceNo: 3, title: "Paint", version: 1 },
    });
    const db = rpcDb({ data: { id: "s_new", source_system: "maximo", source_record_id: "WO-88" }, error: null });
    const plan = {
      creates: [{
        rowIndex: 0,
        fields: { title: "Paint", craftLabel: "Painter", plannedDurationDays: 3, sequenceNo: 3, sourceRecordId: "WO-88" },
        statusTarget: null,
      }],
      updates: [],
    };
    const results = await applyWorkPackageImport(db, {
      ownerId: "owner_1", actor: "user_9", kind: "steps", plan, packageId: "wp_1",
      sourceSystem: "maximo", sourceTrackingAvailable: true,
    });
    expect(results.created).toHaveLength(1);
    expect(results.warnings).toHaveLength(0);
    expect(createWorkStep).toHaveBeenCalledWith(db, expect.objectContaining({
      ownerId: "owner_1", packageId: "wp_1",
      input: expect.objectContaining({ title: "Paint", insertAt: 3 }),
    }));
    expect(db.rpc).toHaveBeenCalledWith("forge_work_step_stamp_source", {
      p_owner_id: "owner_1",
      p_package_id: "wp_1",
      p_step_id: "s_new",
      p_source_system: "maximo",
      p_source_record_id: "WO-88",
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("warns and keeps the row when the stamp RPC fails", async () => {
    createWorkStep.mockResolvedValue({
      ok: true,
      step: { id: "s_new", sequenceNo: 3, title: "Paint", version: 1 },
    });
    const db = rpcDb({ data: null, error: { message: "WPP5_STEP_NOT_FOUND" } });
    const plan = {
      creates: [{
        rowIndex: 0,
        fields: { title: "Paint", sequenceNo: 3, sourceRecordId: "WO-88" },
        statusTarget: null,
      }],
      updates: [],
    };
    const results = await applyWorkPackageImport(db, {
      ownerId: "owner_1", actor: "user_9", kind: "steps", plan, packageId: "wp_1",
      sourceSystem: "maximo", sourceTrackingAvailable: true,
    });
    expect(results.created).toHaveLength(1);
    expect(results.errors).toHaveLength(0);
    expect(results.warnings).toHaveLength(1);
    expect(results.warnings[0].message).toContain("could not be saved");
    expect(db.from).not.toHaveBeenCalled();
  });

  it("updates a changed step with its current version, and skips a no-change one", async () => {
    updateWorkStep.mockResolvedValue({
      ok: true,
      step: { id: "s1", sequenceNo: 1, title: "Fabricate (revised)", version: 3 },
    });
    const currentChanged = {
      id: "s1", sequenceNo: 1, title: "Fabricate", description: null,
      craftLabel: "Pipefitter", plannedDurationDays: 3, plannedPersonHours: 24,
      version: 2, sourceSystem: null, sourceRecordId: null,
    };
    const currentSame = {
      id: "s2", sequenceNo: 2, title: "Install", description: null,
      craftLabel: "Welder", plannedDurationDays: 2, plannedPersonHours: 16,
      version: 1, sourceSystem: null, sourceRecordId: null,
    };
    const plan = {
      creates: [],
      updates: [
        {
          rowIndex: 0, id: "s1", matchKind: "sequence",
          fields: { title: "Fabricate (revised)", craftLabel: "Pipefitter", plannedDurationDays: 3, plannedPersonHours: 24 },
          statusTarget: null, version: 2, current: currentChanged,
        },
        {
          rowIndex: 1, id: "s2", matchKind: "sequence",
          fields: { title: "Install", craftLabel: "Welder", plannedDurationDays: 2, plannedPersonHours: 16 },
          statusTarget: null, version: 1, current: currentSame,
        },
      ],
    };
    const results = await applyWorkPackageImport({}, {
      ownerId: "owner_1", actor: "user_9", kind: "steps", plan, packageId: "wp_1",
      sourceSystem: null, sourceTrackingAvailable: false,
    });
    expect(results.updated).toHaveLength(2);
    expect(updateWorkStep).toHaveBeenCalledTimes(1);
    expect(updateWorkStep).toHaveBeenCalledWith({}, expect.objectContaining({
      stepId: "s1",
      patch: expect.objectContaining({ expectedVersion: 2, title: "Fabricate (revised)" }),
    }));
  });

  it("stamps an updated step through the RPC even when nothing else changed", async () => {
    const db = rpcDb({ data: { id: "s2", source_system: "maximo", source_record_id: "WO-90" }, error: null });
    const current = {
      id: "s2", sequenceNo: 2, title: "Install", description: null,
      craftLabel: "Welder", plannedDurationDays: 2, plannedPersonHours: 16,
      version: 1, sourceSystem: null, sourceRecordId: null,
    };
    const plan = {
      creates: [],
      updates: [{
        rowIndex: 0, id: "s2", matchKind: "sequence",
        fields: { title: "Install", craftLabel: "Welder", plannedDurationDays: 2, plannedPersonHours: 16, sourceRecordId: "WO-90" },
        statusTarget: null, version: 1, current,
      }],
    };
    const results = await applyWorkPackageImport(db, {
      ownerId: "owner_1", actor: "user_9", kind: "steps", plan, packageId: "wp_1",
      sourceSystem: "maximo", sourceTrackingAvailable: true,
    });
    expect(results.updated).toHaveLength(1);
    expect(results.warnings).toHaveLength(0);
    // No content changed, so no versioned update runs — only the stamp.
    expect(updateWorkStep).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith("forge_work_step_stamp_source", {
      p_owner_id: "owner_1",
      p_package_id: "wp_1",
      p_step_id: "s2",
      p_source_system: "maximo",
      p_source_record_id: "WO-90",
    });
    expect(db.from).not.toHaveBeenCalled();
    expect(results.updated[0].step).toMatchObject({ sourceSystem: "maximo", sourceRecordId: "WO-90" });
  });
});
