import { redirect } from "next/navigation";
import ReservationsPageClient from "@/components/forge/reservations/ReservationsPageClient";
import { createClient } from "@/lib/supabase/server";

export default async function ReservationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  return <ReservationsPageClient />;
}
