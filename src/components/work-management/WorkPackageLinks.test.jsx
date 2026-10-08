// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkPackageLinks from "./WorkPackageLinks.jsx";

const LINK = {
  id: "link_1",
  relationship_type: "cost_attributed",
  source_domain: "financial",
  source_type: "financial_event",
  source_id: "event_1",
  target_domain: "workmgmt",
  target_type: "work_package",
  target_id: "forge_wp_1",
  status: "active",
  provenance: "user_confirmed",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("WorkPackageLinks cost refresh hook (Slice 3)", () => {
  it("notifies the package page after a link action reloads links", async () => {
    const onLinksChanged = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      if (url === "/api/work-links/link_1/recheck" && options.method === "POST") {
        return { ok: true, json: async () => ({ link: LINK }) };
      }
      if (url === "/api/work-links?packageId=forge_wp_1") {
        return { ok: true, json: async () => ({ links: [LINK] }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <WorkPackageLinks
          packageId="forge_wp_1"
          initialLinks={[LINK]}
          onLinksChanged={onLinksChanged}
        />,
      );
    });

    const recheck = [...container.querySelectorAll("button")].find((button) => button.textContent === "Re-check");
    await act(async () => { recheck.click(); });
    await act(async () => {});

    expect(onLinksChanged).toHaveBeenCalledTimes(1);
    expect(container.querySelector("#work-package-links")).not.toBeNull();
  });
});
