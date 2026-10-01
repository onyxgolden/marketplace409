import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalListingPublic from "./RentalListingPublic";

describe("public rental listing page", () => {
  it("renders the loading state for a slug", () => {
    const markup = renderToStaticMarkup(<RentalListingPublic slug="abcDEF123456" />);
    expect(markup).toContain("Loading the listing…");
  });
});
