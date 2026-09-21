// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReservationsPageClient from "./ReservationsPageClient.jsx";
import { RV_RESERVATIONS_NAV_GROUP } from "@/components/forge/rental/rvReservationsNavigation";

describe("ReservationsPageClient", () => {
  it("renders the Reservations workspace chrome with the three reservation surfaces", () => {
    const markup = renderToStaticMarkup(<ReservationsPageClient />);
    expect(markup).toContain("data-reservations-application-shell");
    expect(markup).toContain("Reservations");
    for (const item of RV_RESERVATIONS_NAV_GROUP.items) {
      // renderToStaticMarkup escapes & in labels, e.g. "Inventory & Rate Plans".
      expect(markup).toContain(item.label.replace(/&/g, "&amp;"));
    }
    expect(RV_RESERVATIONS_NAV_GROUP.items.map((item) => item.id)).toEqual([
      "reservable-inventory", "reservation-dashboard", "reservations",
    ]);
  });

  it("defaults to the first reservation surface", () => {
    const markup = renderToStaticMarkup(<ReservationsPageClient />);
    expect(markup).toContain('data-active-surface="reservable-inventory"');
  });

  it("honors an explicit initial surface and falls back for an unknown one", () => {
    expect(renderToStaticMarkup(<ReservationsPageClient initialSurfaceId="reservations" />)).toContain('data-active-surface="reservations"');
    expect(renderToStaticMarkup(<ReservationsPageClient initialSurfaceId="nope" />)).toContain('data-active-surface="reservable-inventory"');
  });
});
