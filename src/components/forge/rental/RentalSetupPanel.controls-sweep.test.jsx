// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalSetupPanel, { unitHasDeleteProtection } from "./RentalSetupPanel";

afterEach(() => { clearSWRCache(); });

describe("RentalSetupPanel controls sweep — G4 unit status transitions", () => {
  it("offers Mark available on a preparing unit", () => {
    const markup = renderToStaticMarkup(<RentalSetupPanel initialUnits={[{ id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive", status: "preparing" }]} />);
    expect(markup).toContain("Mark available");
    expect(markup).toContain("Available units can be listed.");
    expect(markup).not.toContain("Mark occupied");
  });

  it("offers Mark occupied and Back to preparing on an available unit", () => {
    const markup = renderToStaticMarkup(<RentalSetupPanel initialUnits={[{ id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive", status: "available" }]} />);
    expect(markup).toContain("Mark occupied");
    expect(markup).toContain("Back to preparing");
    expect(markup).toContain("Mark occupied once the lease is active.");
  });

  it("offers Restore unit in the archived section next to permanent delete", () => {
    const markup = renderToStaticMarkup(<RentalSetupPanel initialUnits={[
      { id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive", status: "available" },
      { id: "unit_2", label: "Old Dup", property_id: "old-dup", status: "inactive" },
    ]} />);
    expect(markup).toContain("Restore unit");
    expect(markup).toContain("Permanently delete duplicate");
  });

  it("posts set-unit-status and confirms when Mark available is clicked", async () => {
    const posted = [];
    const originalFetch = globalThis.fetch;
    const units = [{ id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive", status: "preparing" }];
    globalThis.fetch = async (url, options) => {
      if (options?.method === "POST") {
        posted.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ success: true, unit: { ...units[0], status: "available" } }) };
      }
      return { ok: true, json: async () => ({ units, leases: [], leaseMemberships: [], tenants: [], openCharges: [] }) };
    };
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => { root.render(<RentalSetupPanel initialUnits={units} />); });
      const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === "Mark available");
      expect(button).toBeTruthy();
      await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ operation: "set-unit-status", unitId: "unit_1", status: "available" });
      expect(container.textContent).toContain("930 Highland Drive is now available.");
      await act(async () => { root.unmount(); });
      container.remove();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("RentalSetupPanel controls sweep — G5 archived delete protection", () => {
  it("unitHasDeleteProtection mirrors the server guard's three sources", () => {
    const unit = { id: "unit_1" };
    expect(unitHasDeleteProtection(unit, [], [], [])).toBe(false);
    expect(unitHasDeleteProtection(unit, [{ unit_id: "unit_1" }], [], [])).toBe(true);
    expect(unitHasDeleteProtection(unit, [], [{ unit_id: "unit_1" }], [])).toBe(true);
    expect(unitHasDeleteProtection(unit, [], [], [{ unit_id: "unit_1" }])).toBe(true);
    expect(unitHasDeleteProtection(unit, [{ unit_id: "unit_other" }], [], [])).toBe(false);
  });

  it("disables delete for a history-protected archived unit and keeps it for a clean duplicate", async () => {
    const originalFetch = globalThis.fetch;
    const payload = {
      units: [
        { id: "unit_1", label: "Protected House", property_id: "protected-house", status: "inactive" },
        { id: "unit_2", label: "Clean Dup", property_id: "clean-dup", status: "inactive" },
        { id: "unit_3", label: "Live Unit", property_id: "live-unit", status: "available" },
      ],
      leases: [{ id: "lease_1", unit_id: "unit_1", status: "ended" }],
      leaseMemberships: [], tenants: [], openCharges: [],
      maintenanceRequests: [], inspections: [],
    };
    globalThis.fetch = async () => ({ ok: true, json: async () => payload });
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => { root.render(<RentalSetupPanel initialUnits={payload.units} />); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      const archived = [...container.querySelectorAll("div")].find((candidate) => candidate.textContent.includes("Archived properties"));
      expect(archived).toBeTruthy();
      expect(archived.textContent).toContain("cannot be permanently deleted");
      const deletes = [...archived.querySelectorAll("button")].filter((candidate) => candidate.textContent === "Permanently delete duplicate");
      expect(deletes).toHaveLength(2);
      const byRow = (label) => deletes.find((candidate) => candidate.closest("div").parentElement.textContent.includes(label));
      expect(byRow("Protected House").disabled).toBe(true);
      expect(byRow("Clean Dup").disabled).toBe(false);
      await act(async () => { root.unmount(); });
      container.remove();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
