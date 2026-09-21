import { redirect } from "next/navigation";
import { resolveRentalLanding } from "@/application/rental/resolveRentalLanding";
import RentalPageClient from "@/components/forge/rental/RentalPageClient";
import { createClient } from "@/lib/supabase/server";

export default async function RentalPage({ searchParams }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const destination = await resolveRentalLanding(supabase, user?.id || "");
  if (destination) redirect(destination);
  // Next 16: searchParams is a promise in server components.
  const params = await searchParams;
  const section = typeof params?.section === "string" ? params.section : null;
  return <RentalPageClient initialSection={section} />;
}
