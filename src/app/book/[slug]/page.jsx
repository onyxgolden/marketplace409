import PublicReservationBooking from "@/components/reservations/PublicReservationBooking";

export const metadata = { title: "Book a stay | 409 Marketplace" };

export default async function PublicBookingPage({ params }) {
  const { slug } = await params;
  return <PublicReservationBooking slug={slug} />;
}
