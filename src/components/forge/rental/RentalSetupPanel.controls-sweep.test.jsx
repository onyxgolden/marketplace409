// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalSetupPanel from "./RentalSetupPanel";

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
