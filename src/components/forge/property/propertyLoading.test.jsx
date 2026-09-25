// Property slice warm-switch contract: the converted property panels serve
// cached data on first paint with no loading flash, keep last-good data when
// a refresh fails, and use the shared Forge loading/error/empty states for
// the cold, failed, and empty cases.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";
import PropertyValuationPanel from "./PropertyValuationPanel.jsx";
import PropertyOperatingCostsPanel from "./PropertyOperatingCostsPanel.jsx";
import PropertyEvidenceHistoryPanel from "./PropertyEvidenceHistoryPanel.jsx";

const propertiesPayload = [
  { id: "prop_1", name: "123 Main St" },
];

const valuationsPayload = [
  {
    id: "val_1",
    propertyId: "prop_1",
    amountCents: 25000000,
    valuationType: "owner_estimate",
    source: "manual",
    effectiveAt: "2026-09-01",
    notes: "",
    createdAt: "2026-09-01T00:00:00.000Z",
  },
];

async function seedValuationCache(valuations = valuationsPayload) {
  await fetchWithDedupe(
    "property:portfolio-properties",
    () => Promise.resolve(propertiesPayload),
  );
  await fetchWithDedupe(
    "property:valuations",
    () => Promise.resolve(valuations),
  );
}

beforeEach(() => { clearSWRCache(); });

describe("property slice warm-switch behavior", () => {
  it("renders cached valuations instantly with no loading flash", async () => {
    await seedValuationCache();
    const html = renderToStaticMarkup(<PropertyValuationPanel />);
    // The landing's "Recorded property values" count renders from cache.
    expect(html).toContain(">1</div>");
    expect(html).not.toContain("Loading property valuations");
  });

  it("keeps stale valuations on screen while a refresh is in flight", async () => {
    await seedValuationCache();
    // A refresh that never resolves: the cached count must stay visible with
    // a subtle indicator, never a blank loading state.
    fetchWithDedupe(
      "property:valuations",
      () => new Promise(() => {}),
    );
    const html = renderToStaticMarkup(<PropertyValuationPanel />);
    expect(html).toContain(">1</div>");
    expect(html).toContain("Updating…");
    expect(html).not.toContain("Loading property valuations");
  });

  it("keeps the last good valuations visible when a refresh fails", async () => {
    await seedValuationCache();
    await fetchWithDedupe(
      "property:valuations",
      () => Promise.reject(new Error("refresh failed")),
    ).catch(() => {});
    const html = renderToStaticMarkup(<PropertyValuationPanel />);
    expect(html).toContain(">1</div>");
    expect(html).not.toContain("Loading property valuations");
  });

  it("shows the valuation loading state only when nothing is cached", () => {
    const html = renderToStaticMarkup(<PropertyValuationPanel />);
    expect(html).toContain("Loading property valuations…");
  });

  it("shows the empty valuation count honestly when the cached list is empty", async () => {
    await seedValuationCache([]);
    const html = renderToStaticMarkup(<PropertyValuationPanel />);
    // The landing's "Recorded property values" count renders 0 from cache --
    // no spinner, no blank panel. The ForgeEmptyState covers the history
    // workflow.
    expect(html).toContain(">0</div>");
    expect(html).not.toContain("Loading property valuations");
  });

  it("shows the operating-costs loading state only when nothing is cached", () => {
    const html = renderToStaticMarkup(<PropertyOperatingCostsPanel />);
    expect(html).toContain("Loading operating costs…");
  });

  it("shows the operating-costs error state when the first load fails", async () => {
    await fetchWithDedupe(
      "property:operating-obligations",
      () => Promise.reject(new Error("network down")),
    ).catch(() => {});
    const html = renderToStaticMarkup(<PropertyOperatingCostsPanel />);
    expect(html).toContain("Operating costs could not be loaded.");
    expect(html).not.toContain("Loading operating costs");
  });

  it("renders cached operating obligations with no loading flash", async () => {
    await fetchWithDedupe(
      "property:operating-obligations",
      () => Promise.resolve([{
        id: "obligation_1",
        propertyId: "prop_1",
        obligationType: "fire_insurance",
        subjectLabel: "123 Main St annual insurance",
        recognitionStatus: "accrual_ready",
        reconciledFinancialEventId: "event_1",
      }]),
    );
    const html = renderToStaticMarkup(<PropertyOperatingCostsPanel />);
    expect(html).toContain("data-property-operating-costs-panel");
    expect(html).not.toContain("Loading operating costs");
  });

  it("renders cached evidence instantly with no loading flash", async () => {
    await fetchWithDedupe(
      "property-evidence:prop_1",
      () => Promise.resolve([{
        id: "ev_1",
        propertyId: "prop_1",
        originalFilename: "Invoice 603.pdf",
        mimeType: "application/pdf",
        byteSize: 400,
        createdAt: "2026-08-09T00:00:00.000Z",
      }]),
    );
    const html = renderToStaticMarkup(
      <PropertyEvidenceHistoryPanel propertyId="prop_1" />,
    );
    expect(html).toContain("Invoice 603.pdf");
    expect(html).not.toContain("Loading private evidence");
  });

  it("shows the evidence loading state only when nothing is cached", () => {
    const html = renderToStaticMarkup(
      <PropertyEvidenceHistoryPanel propertyId="prop_1" />,
    );
    expect(html).toContain("Loading private evidence…");
  });

  it("keeps the last good evidence visible when a refresh fails", async () => {
    await fetchWithDedupe(
      "property-evidence:prop_1",
      () => Promise.resolve([{
        id: "ev_1",
        propertyId: "prop_1",
        originalFilename: "Invoice 603.pdf",
        mimeType: "application/pdf",
        byteSize: 400,
        createdAt: "2026-08-09T00:00:00.000Z",
      }]),
    );
    await fetchWithDedupe(
      "property-evidence:prop_1",
      () => Promise.reject(new Error("refresh failed")),
    ).catch(() => {});
    const html = renderToStaticMarkup(
      <PropertyEvidenceHistoryPanel propertyId="prop_1" />,
    );
    expect(html).toContain("Invoice 603.pdf");
    expect(html).not.toContain("Loading private evidence");
  });
});
