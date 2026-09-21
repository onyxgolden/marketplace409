// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PrivateFinancingPageClient from "./PrivateFinancingPageClient.jsx";

describe("PrivateFinancingPageClient", () => {
  it("renders the Private Financing workspace chrome around the existing owner accounts panel", () => {
    const markup = renderToStaticMarkup(<PrivateFinancingPageClient />);
    expect(markup).toContain("data-private-financing-application-shell");
    expect(markup).toContain("Private Financing");
    // The promoted panel itself renders its loading state before its own fetch resolves.
    expect(markup).toContain("Loading private financing accounts");
  });
});
