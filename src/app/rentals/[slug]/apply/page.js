import RentalListingPublic from "@/components/forge/rental/RentalListingPublic";

export default async function RentalListingApplyPage({ params }) {
  const { slug } = await params;
  return <RentalListingPublic slug={slug} initialTab="apply" />;
}
