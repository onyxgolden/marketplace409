// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache, getCacheEntry, seedCacheEntry } from "@/hooks/swrCache";
import { scopedSWRKey } from "./workspaceQuery.js";

import WorkPackageDocuments from "./WorkPackageDocuments.jsx";
import { PackagePageProvider } from "./packagePageContext.jsx";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function renderDocuments(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => {
    root.render(<WorkPackageDocuments packageId="forge_wp_1" initialLinks={[]} {...props} />);
  });
  return { container, root };
}

// Slice-7 friction fix (F4): the controlled load schedules bounded
// revalidation retries, so every mounted root must be unmounted in
// afterEach — clearing the DOM alone never runs the effect cleanup,
// and a stray retry would fetch against the next test's stub.
const mountedRoots = [];

function controlledSectionText(container) {
  const heading = [...container.querySelectorAll("h3")].find((h) => h.textContent === "Controlled drawings");
  expect(heading).not.toBeUndefined();
  return heading.nextElementSibling?.textContent || "";
}

const DRAWING_1 = { drawingId: "forge_wdwg_1", drawingNumber: "W-0005-1", drawingType: "p_id", badge: "IFA — Awaiting review" };
const DRAWING_2 = { drawingId: "forge_wdwg_2", drawingNumber: "W-0005-2", drawingType: "isometric", badge: "IFA — Awaiting review" };

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
  mountedRoots.forEach((root) => {
    try {
      root.unmount();
    } catch {
      // Already unmounted by the test itself.
    }
  });
  mountedRoots.length = 0;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
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

  it("shows the empty controlled state only after the bounded revalidation window", async () => {
    // Friction fix (F4): a first empty answer is revalidated (2 short
    // retries) before the definitive empty state may render — the list
    // was slow to populate after the live S7 test upload.
    vi.useFakeTimers();
    try {
      const { readinessCalls } = stubFetchStateful({ readinessRounds: [[]] });
      const { container } = renderDocuments();
      await act(async () => {});
      expect(container.textContent).not.toContain("No controlled drawings uploaded yet.");
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      await act(async () => {});
      expect(controlledSectionText(container)).toContain("No controlled drawings uploaded yet.");
      expect(readinessCalls()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
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
    await act(async () => {});

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

// Slice-7 friction fix (F4): the controlled-drawings subsection must
// never flash a definitive empty state while a response is still in
// flight or a bounded revalidation is pending, must keep the list
// visible during refresh, and must cancel retries on unmount or
// package-scope change.
describe("WorkPackageDocuments controlled drawings loading states (F4)", () => {
  // readiness: an array of per-call entries, or a function
  // (url, callIndex) => entry. An entry is either an array of drawings
  // or { drawings, delay?, error? }.
  function stubFetchControlled(readiness) {
    const resolve = typeof readiness === "function"
      ? readiness
      : (url, i) => readiness[Math.min(i, readiness.length - 1)];
    let readinessCall = 0;
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      if (typeof url === "string" && url.startsWith("/api/work-links")) {
        return { ok: true, json: async () => ({ links: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/work-documents")) {
        return { ok: true, json: async () => ({ documents: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/forge/designer")) {
        return { ok: true, json: async () => ({ projects: [] }) };
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
        const entry = resolve(url, readinessCall);
        readinessCall += 1;
        if (entry && entry.delay) await entry.delay.promise;
        if (entry && entry.error) return { ok: false, json: async () => ({ error: entry.error }) };
        const drawings = Array.isArray(entry) ? entry : (entry?.drawings ?? []);
        return { ok: true, json: async () => ({ drawings }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    return { readinessCalls: () => readinessCall };
  }

  it("shows loading, never a false empty, while the readiness response is delayed", async () => {
    const gate = deferred();
    stubFetchControlled([{ delay: gate, drawings: [DRAWING_1] }]);
    const { container } = renderDocuments();
    expect(controlledSectionText(container)).toContain("Loading controlled drawings…");
    expect(container.textContent).not.toContain("No controlled drawings uploaded yet.");
    await act(async () => { gate.resolve(); await gate.promise; });
    await act(async () => {});
    expect(controlledSectionText(container)).toContain("W-0005-1");
    expect(container.textContent).not.toContain("No controlled drawings uploaded yet.");
  });

  it("revalidates a transient empty answer and shows the drawing without flashing none", async () => {
    vi.useFakeTimers();
    try {
      const { readinessCalls } = stubFetchControlled([[], [DRAWING_1]]);
      const { container } = renderDocuments();
      await act(async () => {});
      expect(container.textContent).not.toContain("No controlled drawings uploaded yet.");
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      await act(async () => {});
      expect(controlledSectionText(container)).toContain("W-0005-1");
      expect(readinessCalls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the true empty state only after the bounded revalidation window is exhausted", async () => {
    vi.useFakeTimers();
    try {
      const { readinessCalls } = stubFetchControlled([[], [], []]);
      const { container } = renderDocuments();
      await act(async () => {});
      expect(container.textContent).not.toContain("No controlled drawings uploaded yet.");
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      await act(async () => {});
      expect(controlledSectionText(container)).toContain("No controlled drawings uploaded yet.");
      expect(readinessCalls()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels an outstanding revalidation retry on unmount", async () => {
    vi.useFakeTimers();
    try {
      const { readinessCalls } = stubFetchControlled([[]]);
      const { root } = renderDocuments();
      await act(async () => {});
      expect(readinessCalls()).toBe(1);
      act(() => { root.unmount(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(readinessCalls()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the old package's retry on scope change and never shows its drawings", async () => {
    vi.useFakeTimers();
    try {
      const calls = [];
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        calls.push(url);
        if (typeof url === "string" && url.startsWith("/api/work-links")) {
          return { ok: true, json: async () => ({ links: [] }) };
        }
        if (typeof url === "string" && url.startsWith("/api/work-documents")) {
          return { ok: true, json: async () => ({ documents: [] }) };
        }
        if (typeof url === "string" && url.startsWith("/api/forge/designer")) {
          return { ok: true, json: async () => ({ projects: [] }) };
        }
        if (typeof url === "string" && url.includes("/drawings/readiness")) {
          if (url.includes("forge_wp_1")) return { ok: true, json: async () => ({ drawings: [] }) };
          return { ok: true, json: async () => ({ drawings: [DRAWING_1] }) };
        }
        throw new Error(`unexpected fetch ${url}`);
      }));
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      mountedRoots.push(root);
      act(() => {
        root.render(<WorkPackageDocuments packageId="forge_wp_1" initialLinks={[]} />);
      });
      await act(async () => {});
      expect(container.textContent).not.toContain("No controlled drawings uploaded yet.");
      act(() => {
        root.render(<WorkPackageDocuments packageId="forge_wp_2" initialLinks={[]} />);
      });
      await act(async () => {});
      expect(controlledSectionText(container)).toContain("W-0005-1");
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      await act(async () => {});
      expect(calls.filter((u) => u.includes("forge_wp_1") && u.includes("/drawings/readiness"))).toHaveLength(1);
      expect(controlledSectionText(container)).toContain("W-0005-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the old scope's drawings immediately when workspace/project changes with the same packageId, and a delayed response cannot leave them visible", async () => {
    // Friction fix round 1 (F4): the reset identity is the full
    // scope key, not packageId alone. Same package under a new
    // workspace/project must drop the prior scope's list at once.
    const gate = deferred();
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (typeof url === "string" && url.startsWith("/api/work-links")) {
        return { ok: true, json: async () => ({ links: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/work-documents")) {
        return { ok: true, json: async () => ({ documents: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/forge/designer")) {
        return { ok: true, json: async () => ({ projects: [] }) };
      }
      if (typeof url === "string" && url.includes("/drawings/readiness")) {
        if (url.includes("workspace=owner-b")) {
          await gate.promise;
          return { ok: true, json: async () => ({ drawings: [DRAWING_2] }) };
        }
        return { ok: true, json: async () => ({ drawings: [DRAWING_1] }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    act(() => {
      root.render(
        <PackagePageProvider workspace="owner-a" forgeProject="proj-a">
          <WorkPackageDocuments packageId="forge_wp_1" initialLinks={[]} />
        </PackagePageProvider>,
      );
    });
    await act(async () => {});
    expect(controlledSectionText(container)).toContain("W-0005-1");
    // Friction fix round 2 (F4): flushSync commits the new scope
    // synchronously, but the reset effect's microtask has not run
    // yet — so this assertion observes the FIRST commit under the
    // new scope. The old scope's drawings must never be committed
    // under the new scope, not merely cleared after the effect.
    // (The render itself is scope-aware.)
    act(() => {
      flushSync(() => {
        root.render(
          <PackagePageProvider workspace="owner-b" forgeProject="proj-b">
            <WorkPackageDocuments packageId="forge_wp_1" initialLinks={[]} />
          </PackagePageProvider>,
        );
      });
      expect(controlledSectionText(container)).not.toContain("W-0005-1");
      expect(controlledSectionText(container)).toContain("Loading controlled drawings…");
    });
    await act(async () => {});
    // The old scope's drawings are gone immediately — before the
    // new scope's delayed response resolves.
    expect(controlledSectionText(container)).not.toContain("W-0005-1");
    expect(controlledSectionText(container)).toContain("Loading controlled drawings…");
    await act(async () => { gate.resolve(); await gate.promise; });
    await act(async () => {});
    await act(async () => {});
    expect(controlledSectionText(container)).toContain("W-0005-2");
    expect(controlledSectionText(container)).not.toContain("W-0005-1");
  });

  it("a failed response after a workspace change cannot leave the old scope's drawings visible", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (typeof url === "string" && url.startsWith("/api/work-links")) {
        return { ok: true, json: async () => ({ links: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/work-documents")) {
        return { ok: true, json: async () => ({ documents: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/forge/designer")) {
        return { ok: true, json: async () => ({ projects: [] }) };
      }
      if (typeof url === "string" && url.includes("/drawings/readiness")) {
        if (url.includes("workspace=owner-b")) {
          return { ok: false, json: async () => ({ error: "Readiness unavailable." }) };
        }
        return { ok: true, json: async () => ({ drawings: [DRAWING_1] }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    act(() => {
      root.render(
        <PackagePageProvider workspace="owner-a" forgeProject="proj-a">
          <WorkPackageDocuments packageId="forge_wp_1" initialLinks={[]} />
        </PackagePageProvider>,
      );
    });
    await act(async () => {});
    expect(controlledSectionText(container)).toContain("W-0005-1");
    // Friction fix round 2 (F4): flushSync commits the new scope
    // synchronously, but the reset effect's microtask has not run
    // yet — so this assertion observes the FIRST commit under the
    // new scope, before the reset effect or the failed response.
    // The old scope's drawings must never render here.
    act(() => {
      flushSync(() => {
        root.render(
          <PackagePageProvider workspace="owner-b" forgeProject="proj-b">
            <WorkPackageDocuments packageId="forge_wp_1" initialLinks={[]} />
          </PackagePageProvider>,
        );
      });
      expect(controlledSectionText(container)).not.toContain("W-0005-1");
      expect(controlledSectionText(container)).toContain("Loading controlled drawings…");
    });
    await act(async () => {});
    await act(async () => {});
    expect(controlledSectionText(container)).not.toContain("W-0005-1");
    expect(controlledSectionText(container)).toContain("Could not load controlled drawings");
  });

  it("keeps the existing list visible with a Refreshing… label while a refresh is in flight", async () => {
    const gate = deferred();
    let readinessCall = 0;
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      if (typeof url === "string" && url.startsWith("/api/work-links")) {
        return { ok: true, json: async () => ({ links: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/work-documents")) {
        return { ok: true, json: async () => ({ documents: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/forge/designer")) {
        return { ok: true, json: async () => ({ projects: [] }) };
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
        readinessCall += 1;
        if (readinessCall === 2) await gate.promise;
        return { ok: true, json: async () => ({ drawings: readinessCall === 1 ? [DRAWING_1] : [DRAWING_1, DRAWING_2] }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const { container } = renderDocuments();
    await act(async () => {});
    expect(controlledSectionText(container)).toContain("W-0005-1");
    setControlledText(container, "Drawing number", "W-0005-2");
    selectControlledFile(container);
    const form = container.querySelector("#controlled-drawing-intake form");
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => {});
    await act(async () => {});
    expect(controlledSectionText(container)).toContain("W-0005-1");
    expect(container.textContent).toContain("Refreshing…");
    expect(container.textContent).not.toContain("No controlled drawings uploaded yet.");
    await act(async () => { gate.resolve(); await gate.promise; });
    await act(async () => {});
    await act(async () => {});
    expect(controlledSectionText(container)).toContain("W-0005-2");
    expect(container.textContent).not.toContain("Refreshing…");
  });

  it("shows an error, not the empty state, when the readiness fetch fails", async () => {
    stubFetchControlled([{ error: "Readiness unavailable." }]);
    const { container } = renderDocuments();
    await act(async () => {});
    expect(controlledSectionText(container)).toContain("Could not load controlled drawings");
    expect(container.textContent).not.toContain("No controlled drawings uploaded yet.");
  });
});
