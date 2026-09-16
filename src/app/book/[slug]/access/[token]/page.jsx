import GuestReservationAccess from "@/components/reservations/GuestReservationAccess";

export const metadata = { title: "Reservation access | 409 Marketplace" };

export default async function ReservationAccessPage({ params }) {
  const { slug, token = "" } = await params;
  return <GuestReservationAccess slug={slug} token={token} />;
}
