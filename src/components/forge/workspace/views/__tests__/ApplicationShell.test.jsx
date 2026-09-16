// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import ApplicationShell, {
  normalizeApplicationFunctions,
  resolveActiveFunction,
} from "../../ApplicationShell.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

describe(
  "ApplicationShell",
  () => {
    const functions = [
      {
        id: "overview",
        label: "Overview",
      },
      {
        id: "transactions",
        label: "Transactions",
      },
      {
        id: "properties",
        label: "Properties",
      },
    ];

    it(
      "renders contextual application navigation and one active surface",
      () => {
        const markup =
          renderToStaticMarkup(
            <ApplicationShell
              applicationName="Financial"
              applicationDescription="Focused financial operations."
              functions={functions}
              activeFunctionId="transactions"
              activeSurface={
                <section>
                  Transaction workspace
                </section>
              }
            />,
          );

        expect(markup).toContain(
          "data-application-shell",
        );

        expect(markup).toContain(
          'data-active-function="transactions"',
        );

        expect(markup).toContain(
          'data-active-function-surface="transactions"',
        );

        expect(markup).not.toContain(
          "← Workspace",
        );

        expect(markup).toContain(
          "Financial",
        );

        expect(markup).toContain(
          "Overview",
        );

        expect(markup).toContain(
          "Transactions",
        );

        expect(markup).toContain(
          "Properties",
        );

        expect(markup).toContain(
          'aria-current="page"',
        );

        expect(markup).toContain(
          "Transaction workspace",
        );

        expect(markup).not.toContain(
          "Inactive overview content",
        );
      },
    );

    it(
      "falls back to the first valid function",
      () => {
        expect(
          resolveActiveFunction(
            functions,
            "missing",
          ),
        ).toBe("overview");

        const markup =
          renderToStaticMarkup(
            <ApplicationShell
              applicationName="Financial"
              functions={functions}
              activeFunctionId="missing"
              activeSurface={
                <div>
                  Overview workspace
                </div>
              }
            />,
          );

        expect(markup).toContain(
          'data-active-function="overview"',
        );

        expect(markup).toContain(
          "Overview workspace",
        );
      },
    );

    it(
      "normalizes the function contract",
      () => {
        const normalized =
          normalizeApplicationFunctions([
            {
              id: " overview ",
              label: " Overview ",
            },
            {
              id: "",
              label: "Invalid",
            },
            null,
          ]);

        expect(normalized).toEqual([
          {
            id: "overview",
            label: "Overview",
          },
        ]);

        expect(
          Object.isFrozen(
            normalized,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            normalized[0],
          ),
        ).toBe(true);
      },
    );

    it(
      "recomposes navigation through overflow instead of shrinking controls",
      () => {
        const markup =
          renderToStaticMarkup(
            <ApplicationShell
              applicationName="Financial"
              functions={functions}
              activeFunctionId="overview"
              activeSurface={
                <div>Overview</div>
              }
            />,
          );

        expect(markup).toContain(
          "overflow-x-auto",
        );

        expect(markup).toContain(
          "shrink-0",
        );

        expect(markup).toContain(
          "max-w-[1800px]",
        );
      },
    );

    it("offers no Customize control and never calls the sidebar preferences API when sidebarKey is omitted (Property's case)", () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const markup = renderToStaticMarkup(
        <ApplicationShell applicationName="Property" functions={functions} activeFunctionId="overview" activeSurface={<div>Overview</div>} />,
      );
      expect(markup).not.toContain("Customize");
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    describe("Customize sidebar (hide/show nav items) when sidebarKey is passed", () => {
      let mounted;

      function mockFetch({ initialHidden = [], patchOk = true } = {}) {
        const fetchMock = vi.fn((url, options) => {
          if (!options) return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, hiddenItemIds: initialHidden }) });
          if (options.method === "PATCH") {
            const body = JSON.parse(options.body);
            return Promise.resolve(patchOk
              ? { ok: true, json: () => Promise.resolve({ success: true, hiddenItemIds: body.hiddenItemIds }) }
              : { ok: false, json: () => Promise.resolve({ error: "boom" }) });
          }
          return Promise.reject(new Error(`unexpected fetch: ${url} ${JSON.stringify(options)}`));
        });
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
      }

      function openCustomize(container) {
        act(() => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent.trim() === "Customize").click(); });
      }
      function checkboxFor(container, label) {
        return Array.from(container.querySelectorAll('input[type="checkbox"]'))
          .find((input) => input.closest("label").textContent === label);
      }
      function navButtonLabels(container) {
        return Array.from(container.querySelectorAll('nav[aria-label="Financial functions"] button'))
          .filter((button) => !button.hasAttribute("aria-expanded") && button.textContent.trim() !== "Customize")
          .map((button) => button.textContent);
      }

      afterEach(() => {
        if (mounted) { unmount(mounted); mounted = null; }
        vi.unstubAllGlobals();
      });

      it("never offers the first (home) function as hideable", async () => {
        mockFetch();
        mounted = mount(<ApplicationShell applicationName="Financial" functions={functions} activeFunctionId="overview" activeSurface={<div />} sidebarKey="financial" />);
        await flush();
        openCustomize(mounted.container);
        expect(checkboxFor(mounted.container, "Overview")).toBeUndefined();
      });

      it("loads saved hidden items on mount, GETs the given sidebar key, and removes them from the nav", async () => {
        const fetchMock = mockFetch({ initialHidden: ["properties"] });
        mounted = mount(<ApplicationShell applicationName="Financial" functions={functions} activeFunctionId="overview" activeSurface={<div />} sidebarKey="financial" />);
        await flush();
        expect(fetchMock).toHaveBeenCalledWith("/api/preferences/sidebar/financial");
        expect(navButtonLabels(mounted.container)).not.toContain("Properties");
      });

      it("hiding an item persists via PATCH to the given sidebar key", async () => {
        const fetchMock = mockFetch({ initialHidden: [] });
        mounted = mount(<ApplicationShell applicationName="Financial" functions={functions} activeFunctionId="overview" activeSurface={<div />} sidebarKey="financial" />);
        await flush();
        openCustomize(mounted.container);
        act(() => { checkboxFor(mounted.container, "Properties").click(); });
        await flush();
        expect(fetchMock).toHaveBeenCalledWith("/api/preferences/sidebar/financial", expect.objectContaining({
          method: "PATCH", body: JSON.stringify({ hiddenItemIds: ["properties"] }),
        }));
        expect(navButtonLabels(mounted.container)).not.toContain("Properties");
      });

      it("rolls the checkbox and the nav back, and shows a visible error, when the PATCH fails", async () => {
        mockFetch({ initialHidden: [], patchOk: false });
        mounted = mount(<ApplicationShell applicationName="Financial" functions={functions} activeFunctionId="overview" activeSurface={<div />} sidebarKey="financial" />);
        await flush();
        openCustomize(mounted.container);
        act(() => { checkboxFor(mounted.container, "Properties").click(); });
        await flush();
        expect(mounted.container.querySelector('[role="alert"]')).not.toBeNull();
        expect(checkboxFor(mounted.container, "Properties").checked).toBe(true);
        expect(navButtonLabels(mounted.container)).toContain("Properties");
      });

      it("still renders a hidden item's own surface when directly navigated to, even though it's absent from the nav", async () => {
        mockFetch({ initialHidden: ["properties"] });
        mounted = mount(<ApplicationShell applicationName="Financial" functions={functions} activeFunctionId="properties" activeSurface={<div>Properties workspace</div>} sidebarKey="financial" />);
        await flush();
        expect(mounted.container.querySelector('[data-active-function="properties"]')).not.toBeNull();
        expect(mounted.container.textContent).toContain("Properties workspace");
        expect(navButtonLabels(mounted.container)).not.toContain("Properties");
      });
    });
  },
);
