import GuestReservationAccess from "@/components/reservations/GuestReservationAccess";

export const metadata = { title: "Reservation access | 409 Marketplace" };

export default async function ReservationAccessPage({ params, searchParams }) {
  const { slug } = await params;
  const { token = "" } = await searchParams;
  return <GuestReservationAccess slug={slug} token={token} />;
}
