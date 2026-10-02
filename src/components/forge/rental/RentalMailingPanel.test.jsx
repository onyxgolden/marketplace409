import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalMailingPanel from "./RentalMailingPanel";

describe("rental mailing panel", () => {
  it("renders the Mailing Manager shell with the four tabs", () => {
    const markup = renderToStaticMarkup(<RentalMailingPanel />);
    expect(markup).toContain("Mailing Manager");
    expect(markup).toContain("Compose");
    expect(markup).toContain("Queue &amp; tracking");
    expect(markup).toContain("Templates");
    expect(markup).toContain("Provider");
    expect(markup).toContain("Loading mailing data…");
  });

  it("states the free-layer promise: letters are never sent through a provider", () => {
    const markup = renderToStaticMarkup(<RentalMailingPanel />);
    expect(markup).toContain("never");
    expect(markup).toContain("sent through a mail provider");
  });

  it("names the compliance workflow in the intro copy", () => {
    const markup = renderToStaticMarkup(<RentalMailingPanel />);
    expect(markup).toContain("preview each letter with real tenant data");
    expect(markup).toContain("mail at the post office");
    expect(markup).toContain("tracking numbers");
  });
});
