// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@/components/forge/TransactionReviewContainer",
  () => ({
    default: function TransactionReviewContainerStub() {
      return <div data-transaction-review-container-stub />;
    },
  }),
);

import FinancialImportTool from "./FinancialImportTool.jsx";
import { clearSWRCache } from "@/hooks/swrCache";

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<FinancialImportTool />);
  });
  return { container, root };
}

function unmount(mounted) {
  act(() => {
    mounted.root.unmount();
  });
  mounted.container.remove();
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const BOOTSTRAP = {
  success: true,
  data: { ownerId: "owner-1", properties: [] },
};

const IMPORT_RESULT = {
  fileName: "rentec.csv",
  result: {
    summary: {
      totalRows: 2,
      importedRows: 2,
      skippedRows: 0,
      properties: ["308 Paula"],
      totalIncome: 1600,
      totalExpenses: 200,
    },
    transactionReview: [],
    records: [],
    reports: { balanceSheet: null, incomeStatement: null, trialBalance: null },
  },
  error: null,
  ownerId: "owner-1",
  hasFile: true,
};

function stubFetch({ importPayload = IMPORT_RESULT, importDelay = 0 } = {}) {
  const calls = [];
  const fetchMock = vi.fn(async (url, init) => {
    calls.push(url);
    if (url === "/api/financial/import/bootstrap") {
      return { ok: true, json: async () => BOOTSTRAP };
    }
    if (url === "/api/financial/import") {
      if (importDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, importDelay));
      }
      return { ok: true, json: async () => ({ success: true, data: importPayload }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function setInputFiles(input, files) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("FinancialImportTool file handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    clearSWRCache();
  });

  it("ignores a cancelled file picker without wiping prior results or throwing", async () => {
    const { calls } = stubFetch();
    const mounted = mount();
    try {
      await flush();

      // First a successful import so there are prior results to protect.
      const input = mounted.container.querySelector('input[type="file"]');
      setInputFiles(input, [
        new File(["date,amount\n2026-08-01,1600"], "rentec.csv", { type: "text/csv" }),
      ]);
      await flush();
      expect(
        mounted.container.querySelector("[data-import-result]").getAttribute("data-import-result")
      ).toBe("ready");
      const importCallsBefore = calls.filter((url) => url === "/api/financial/import").length;
      expect(importCallsBefore).toBe(1);

      // Now cancel the picker: no file, no crash, results untouched.
      setInputFiles(input, []);
      await flush();

      expect(
        mounted.container.querySelector("[data-import-result]").getAttribute("data-import-result")
      ).toBe("ready");
      expect(calls.filter((url) => url === "/api/financial/import").length).toBe(
        importCallsBefore
      );
      expect(mounted.container.textContent).not.toContain("Unable to import");
    } finally {
      unmount(mounted);
    }
  });

  it("shows a busy indicator and disables the picker while the CSV is being parsed", async () => {
    let releaseImport;
    const importGate = new Promise((resolve) => {
      releaseImport = resolve;
    });
    const fetchMock = vi.fn(async (url) => {
      if (url === "/api/financial/import/bootstrap") {
        return { ok: true, json: async () => BOOTSTRAP };
      }
      if (url === "/api/financial/import") {
        await importGate;
        return { ok: true, json: async () => ({ success: true, data: IMPORT_RESULT }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const mounted = mount();
    try {
      await flush();
      const input = mounted.container.querySelector('input[type="file"]');
      setInputFiles(input, [
        new File(["date,amount\n2026-08-01,1600"], "rentec.csv", { type: "text/csv" }),
      ]);
      await flush();

      // While the POST is in flight the busy state is visible.
      expect(input.disabled).toBe(true);
      expect(mounted.container.querySelector('[role="status"]').textContent).toContain("Parsing");

      await act(async () => {
        releaseImport();
      });
      await flush();

      expect(input.disabled).toBe(false);
      expect(
        mounted.container.querySelector("[data-import-result]").getAttribute("data-import-result")
      ).toBe("ready");
    } finally {
      unmount(mounted);
    }
  });
});
