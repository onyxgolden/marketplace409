// Owns the RV & Short-Term Rentals nav group and its surface mapping as one self-contained unit,
// deliberately separate from RENTAL_NAVIGATION/buildRentalSurface's long-term-rental definitions —
// so lifting RV/cabin reservation operations into their own app later is a mechanical move of this
// one file (plus its three panel components), not an untangling exercise.
import ReservationInventoryPanel from "./ReservationInventoryPanel";
import ReservationsPanel from "./ReservationsPanel";
import ReservationOperationsDashboard from "./ReservationOperationsDashboard";

export const RV_RESERVATIONS_NAV_GROUP = Object.freeze({
  label: "RV & Short-Term Rentals",
  items: Object.freeze([
    { id: "reservable-inventory", label: "Inventory & Rate Plans" },
    { id: "reservation-dashboard", label: "Operations Dashboard" },
    { id: "reservations", label: "Reservations" },
  ]),
});

export function buildRvReservationsSurface(id) {
  const surfaces = {
    "reservable-inventory": <ReservationInventoryPanel />,
    "reservation-dashboard": <ReservationOperationsDashboard />,
    reservations: <ReservationsPanel />,
  };
  return surfaces[id] || null;
}
