import { redirect } from "next/navigation";
import { resolveRentalLanding } from "@/application/rental/resolveRentalLanding";
import RentalPageClient from "@/components/forge/rental/RentalPageClient";
import { resolveRentalRecordContextParam } from "@/components/forge/rental/rentalRecordParam";
import { createClient } from "@/lib/supabase/server";

export default async function RentalPage({ searchParams }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const destination = await resolveRentalLanding(supabase, user?.id || "");
  if (destination) redirect(destination);
  // Next 16: searchParams is a promise in server components.
  const params = await searchParams;
  const section = typeof params?.section === "string" ? params.section : null;
  // Record context (?recordType/?recordId/?propertyId) is written by RentalPageClient
  // on every navigation: a reload restores the selected record instead of dropping
  // to the dashboard. Unknown types and missing ids resolve to null (no context).
  const initialRecordContext = resolveRentalRecordContextParam({
    recordType: typeof params?.recordType === "string" ? params.recordType : null,
    recordId: typeof params?.recordId === "string" ? params.recordId : null,
    propertyId: typeof params?.propertyId === "string" ? params.propertyId : null,
  });
  return <RentalPageClient initialSection={section} initialRecordContext={initialRecordContext} />;
}
