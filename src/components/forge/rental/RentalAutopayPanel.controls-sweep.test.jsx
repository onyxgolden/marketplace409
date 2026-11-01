// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalAutopayPanel from "./RentalAutopayPanel";

beforeEach(() => { clearSWRCache(); });
afterEach(() => { vi.unstubAllGlobals(); clearSWRCache(); });

const body = (enrollments) => ({
  autopayEnrollments: enrollments,
  leases: [{ id: "lease_1", unit_id: "unit_1" }],
  units: [{ id: "unit_1", label: "1218 Wagner" }],
  tenants: [{ id: "tenant_1", display_name: "Anthony Babino" }],
  leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
});

async function renderWith(enrollments) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body(enrollments) })));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<RentalAutopayPanel />); });
  await act(async () => {});
  return { container, root };
}

function enrollment(overrides) {
  return {
    id: "enr_1", lease_id: "lease_1", tenant_id: "tenant_1", status: "active",
    payment_method_type: "us_bank_account", charge_day: 1, reminder_days_before: 3,
    consented_at: "2026-08-01T12:00:00Z", cancelled_at: null, ...overrides,
  };
}

describe("RentalAutopayPanel controls sweep — B3", () => {
  it("offers pause, edit, and cancel for an active enrollment with a resolved name", async () => {
    const { container, root } = await renderWith([enrollment({})]);
    expect(container.textContent).toContain("Anthony Babino — 1218 Wagner");
    expect(container.textContent).toContain("Pause autopay");
    expect(container.textContent).toContain("Edit timing");
    expect(container.textContent).toContain("Cancel autopay");
    expect(container.textContent).not.toContain("Resume autopay");
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("offers resume instead of pause for a paused enrollment", async () => {
    const { container, root } = await renderWith([enrollment({ status: "paused" })]);
    expect(container.textContent).toContain("Resume autopay");
    expect(container.textContent).not.toContain("Pause autopay");
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("explains setup and offers cancel for a setup_required enrollment", async () => {
    const { container, root } = await renderWith([enrollment({ status: "setup_required" })]);
    expect(container.textContent).toContain("Setup still incomplete");
    expect(container.textContent).toContain("Cancel autopay");
    expect(container.textContent).not.toContain("Pause autopay");
    expect(container.textContent).not.toContain("Resume autopay");
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("offers no actions for a cancelled enrollment", async () => {
    const { container, root } = await renderWith([enrollment({ status: "cancelled", cancelled_at: "2026-09-01T12:00:00Z" })]);
    expect(container.textContent).not.toContain("Pause autopay");
    expect(container.textContent).not.toContain("Resume autopay");
    expect(container.textContent).not.toContain("Edit timing");
    expect(container.textContent).not.toContain("Cancel autopay");
    await act(async () => { root.unmount(); });
    container.remove();
  });
});
