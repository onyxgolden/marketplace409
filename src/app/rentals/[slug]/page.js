import RentalListingPublic from "@/components/forge/rental/RentalListingPublic";

export default async function RentalListingPage({ params }) {
  const { slug } = await params;
  return <RentalListingPublic slug={slug} />;
}
