import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalInsuranceAddonsPanel from "./RentalInsuranceAddonsPanel";

describe("RentalInsuranceAddonsPanel (R24)", () => {
  it("renders the compliance, requirements, deposit-choice, pets, and partner-gate sections", () => {
    const markup = renderToStaticMarkup(<RentalInsuranceAddonsPanel />);
    expect(markup).toContain("Insurance &amp; pets compliance");
    expect(markup).toContain("Per-property requirements");
    expect(markup).toContain("Deposit choice per lease");
    expect(markup).toContain("Pet records");
    expect(markup).toContain("Insurance partner products — not connected");
    expect(markup).toContain("Reminders are in-app only");
  });

  it("states the deposit-choice record-only rule and the partner gate in plain language", () => {
    const markup = renderToStaticMarkup(<RentalInsuranceAddonsPanel />);
    expect(markup).toContain("Record-only — the money movement stays in the existing deposit flows.");
    expect(markup).toContain("No partner is signed up for, contacted, or paid");
    expect(markup).toContain("What Jason must approve before go-live");
  });

  it("offers the partner-status check (not a dead button)", () => {
    const markup = renderToStaticMarkup(<RentalInsuranceAddonsPanel />);
    expect(markup).toContain("Check partner status");
  });
});
