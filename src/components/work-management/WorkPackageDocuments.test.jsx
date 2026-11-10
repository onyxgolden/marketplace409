// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

// D18: the Designer-project picker showed the same project repeated
// (same id multiple times) plus case-variant name duplicates, with no
// loading state -- it briefly rendered as a plain required textbox while
// the three parallel fetches were still in flight.
describe("WorkPackageDocuments Link-existing picker (D18)", () => {
  function stubFetch({ designerProjects }) {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (typeof url === "string" && url.startsWith("/api/work-links")) {
        return { ok: true, json: async () => ({ links: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/work-documents")) {
        return { ok: true, json: async () => ({ documents: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/forge/designer")) {
        return { ok: true, json: async () => ({ projects: designerProjects }) };
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
