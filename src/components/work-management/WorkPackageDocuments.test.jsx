// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache, getCacheEntry, seedCacheEntry } from "@/hooks/swrCache";
import { scopedSWRKey } from "./workspaceQuery.js";

import WorkPackageDocuments from "./WorkPackageDocuments.jsx";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function renderDocuments(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<WorkPackageDocuments packageId="forge_wp_1" initialLinks={[]} {...props} />);
  });
  return { container, root };
}

function selectControlledFile(container, name = "W-0005-2.pdf") {
  const input = container.querySelector('#controlled-drawing-intake input[type="file"]');
  const file = new File([new TextEncoder().encode("%PDF-1.7\n%test\n%%EOF\n")], name, { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [file] });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function setControlledText(container, label, value) {
  const input = [...container.querySelectorAll("#controlled-drawing-intake input, #controlled-drawing-intake select")].find((el) => {
    const id = el.getAttribute("id");
    const labelEl = id && container.querySelector(`label[for="${id}"]`);
    return labelEl && labelEl.textContent.includes(label);
  });
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitControlledForm(container) {
  const form = container.querySelector("#controlled-drawing-intake form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
  await act(async () => {});
}

beforeEach(() => {
  clearSWRCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.innerHTML = "";
  clearSWRCache();
});

// D18: the Designer-project picker showed the same project repeated
// (same id multiple times) plus case-variant name duplicates, with no
// loading state -- it briefly rendered as a plain required textbox while
// the three parallel fetches were still in flight.
describe("WorkPackageDocuments Link-existing picker (D18)", () => {
  function stubFetch({ designerProjects, links = [], readinessDrawings = [] }) {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (typeof url === "string" && url.startsWith("/api/work-links")) {
        return { ok: true, json: async () => ({ links }) };
      }
      if (typeof url === "string" && url.startsWith("/api/work-documents")) {
        return { ok: true, json: async () => ({ documents: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/forge/designer")) {
        return { ok: true, json: async () => ({ projects: designerProjects }) };
      }
      if (typeof url === "string" && url.includes("/drawings/readiness")) {
        return { ok: true, json: async () => ({ drawings: readinessDrawings }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
  }

  it("dedupes a literally repeated project id to one option", async () => {
    stubFetch({
      designerProjects: [
        { id: "proj_1", name: "FCCU Plot Plan (Fictional)" },
        { id: "proj_1", name: "FCCU Plot Plan (Fictional)" },
        { id: "proj_1", name: "FCCU Plot Plan (Fictional)" },
      ],
    });
    const { container } = renderDocuments();
    await act(async () => {});
    const options = [...container.querySelectorAll("select option")].filter((o) => o.textContent.includes("FCCU"));
    expect(options).toHaveLength(1);
  });

  it("dedupes case-variant duplicate names (different ids) to one option", async () => {
    stubFetch({
      designerProjects: [
        { id: "proj_a", name: "highland" },
        { id: "proj_b", name: "Highland" },
      ],
    });
    const { container } = renderDocuments();
    await act(async () => {});
    const options = [...container.querySelectorAll("select option")].filter((o) => /highland/i.test(o.textContent));
    expect(options).toHaveLength(1);
  });

  it("shows a loading state instead of the plain-textbox fallback while data is in flight", async () => {
    const gate = deferred();
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (typeof url === "string" && url.startsWith("/api/forge/designer")) {
        await gate.promise;
        return { ok: true, json: async () => ({ projects: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/work-links")) return { ok: true, json: async () => ({ links: [] }) };
      if (typeof url === "string" && url.startsWith("/api/work-documents")) return { ok: true, json: async () => ({ documents: [] }) };
      if (typeof url === "string" && url.includes("/drawings/readiness")) return { ok: true, json: async () => ({ drawings: [] }) };
      throw new Error(`unexpected fetch ${url}`);
    }));
    const { container } = renderDocuments();
    // Still in flight: no required raw textbox, a loading placeholder instead.
    expect(container.querySelector('input[placeholder="Designer project id"]')).toBeNull();
    expect(container.textContent).toContain("Loading…");
    await act(async () => { gate.resolve(); await gate.promise; });
    await act(async () => {});
  });

  it("falls back to the free-text id input once loaded with genuinely zero projects", async () => {
    stubFetch({ designerProjects: [] });
    const { container } = renderDocuments();
    await act(async () => {});
    expect(container.textContent).not.toContain("Loading…");
    expect(container.querySelector('input[placeholder="Designer project id"]')).not.toBeNull();
  });
});

// Slice-7 review-gating fix (S7-RG-05/06): the Documents tab shows a
// distinct "Controlled drawings" subsection (separate from the
// Designer-linked "Drawings"), refreshes it after a successful
// upload, and invalidates the Redlines panel's exact scoped
// readiness SWR key — no reload, no other scope touched.
describe("WorkPackageDocuments controlled drawings + upload refresh", () => {
  const READINESS_KEY = scopedSWRKey(null, "work-packages", "forge_wp_1", "drawing-readiness");
  const OTHER_SCOPE_KEY = scopedSWRKey(
    { workspace: "other-owner", forgeProject: "other-project" },
    "work-packages", "forge_wp_1", "drawing-readiness",
  );

  function stubFetchStateful({ designerProjects = [], links = [], readinessRounds }) {
    const calls = [];
    let readinessCall = 0;
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET" });
      if (typeof url === "string" && url.startsWith("/api/work-links")) {
        return { ok: true, json: async () => ({ links }) };
      }
      if (typeof url === "string" && url.startsWith("/api/work-documents")) {
        return { ok: true, json: async () => ({ documents: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/forge/designer")) {
        return { ok: true, json: async () => ({ projects: designerProjects }) };
      }
      if (typeof url === "string" && url.includes("/drawings/intake")) {
        return {
          ok: true,
          json: async () => ({
            artifact: { id: "forge_wpa_2", drawingId: "forge_wdwg_2", contentSha256: "c".repeat(64) },
            drawing: { id: "forge_wdwg_2" }, revision: { id: "forge_wpdrv_2" }, replayed: false,
          }),
        };
      }
      if (typeof url === "string" && url.includes("/drawings/readiness")) {
        const drawings = readinessRounds[Math.min(readinessCall, readinessRounds.length - 1)];
        readinessCall += 1;
        return { ok: true, json: async () => ({ drawings }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    return { calls, readinessCalls: () => readinessCall };
  }

  function controlledSectionText(container) {
    const heading = [...container.querySelectorAll("h3")].find((h) => h.textContent === "Controlled drawings");
    expect(heading).not.toBeUndefined();
    return heading.nextElementSibling?.textContent || "";
  }

  it("renders controlled drawings as a distinct subsection, separate from Designer-linked Drawings", async () => {
    stubFetchStateful({
      designerProjects: [{ id: "proj_1", name: "FCCU Plot Plan (Fictional)" }],
      links: [{
        id: "link_1", relationship_type: "supported_by_drawing",
        source_domain: "workmgmt", source_type: "work_package", source_id: "forge_wp_1",
        target_domain: "designer", target_type: "project", target_id: "proj_1", status: "active",
      }],
      readinessRounds: [[
        { drawingId: "forge_wdwg_1", drawingNumber: "W-0005-1", drawingType: "p_id", badge: "IFA — Awaiting review" },
      ]],
    });
    const { container } = renderDocuments();
    await act(async () => {});
    // The Designer-linked drawing stays under "Drawings".
    expect(container.textContent).toContain("FCCU Plot Plan (Fictional)");
    // The controlled drawing lives in its own subsection — not mixed in.
    expect(controlledSectionText(container)).toContain("W-0005-1");
    expect(controlledSectionText(container)).not.toContain("FCCU Plot Plan");
    expect(container.textContent).not.toContain("No controlled drawings uploaded yet.");
  });

  it("shows the empty controlled state when no controlled drawings exist", async () => {
    stubFetchStateful({ readinessRounds: [[]] });
    const { container } = renderDocuments();
    await act(async () => {});
    expect(controlledSectionText(container)).toContain("No controlled drawings uploaded yet.");
  });

  it("refreshes the controlled list after upload and invalidates only the exact scoped readiness key", async () => {
    // A stale readiness entry for this scope plus one for another
    // scope: only this scope's entry may be dropped by the upload.
    seedCacheEntry(READINESS_KEY, { drawings: [], stale: true });
    seedCacheEntry(OTHER_SCOPE_KEY, { drawings: [], stale: true });
    const { calls, readinessCalls } = stubFetchStateful({
      readinessRounds: [
        [{ drawingId: "forge_wdwg_1", drawingNumber: "W-0005-1", drawingType: "p_id", badge: "IFA — Awaiting review" }],
        [
          { drawingId: "forge_wdwg_1", drawingNumber: "W-0005-1", drawingType: "p_id", badge: "IFA — Awaiting review" },
          { drawingId: "forge_wdwg_2", drawingNumber: "W-0005-2", drawingType: "isometric", badge: "IFA — Awaiting review" },
        ],
      ],
    });
    const { container } = renderDocuments();
    await act(async () => {});
    expect(readinessCalls()).toBe(1);
    expect(controlledSectionText(container)).toContain("W-0005-1");
    expect(controlledSectionText(container)).not.toContain("W-0005-2");

    setControlledText(container, "Drawing number", "W-0005-2");
    selectControlledFile(container);
    await submitControlledForm(container);

    expect(calls.some((c) => c.url.includes("/drawings/intake") && c.method === "POST")).toBe(true);
    // The Documents refresh re-fetched readiness — the new drawing is listed.
    expect(readinessCalls()).toBeGreaterThan(1);
    expect(controlledSectionText(container)).toContain("W-0005-2");
    // The exact scoped readiness entry is gone; another scope survives.
    expect(getCacheEntry(READINESS_KEY)).toBeFalsy();
    expect(getCacheEntry(OTHER_SCOPE_KEY)).toBeTruthy();
  });

  it("consumes a prefill once on mount and prefills the intake form from it", async () => {
    stubFetchStateful({ readinessRounds: [[]] });
    const onIntakeDrawingConsumed = vi.fn();
    const { container } = renderDocuments({
      initialDrawing: { drawingNumber: "W-0005-1", drawingType: "p_id" },
      onIntakeDrawingConsumed,
    });
    await act(async () => {});
    expect(container.querySelector("#controlled-drawing-number").value).toBe("W-0005-1");
    expect(container.querySelector("#controlled-drawing-type").value).toBe("p_id");
    expect(onIntakeDrawingConsumed).toHaveBeenCalledTimes(1);
  });
});
