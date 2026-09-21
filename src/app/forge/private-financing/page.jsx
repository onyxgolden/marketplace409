import { redirect } from "next/navigation";
import PrivateFinancingPageClient from "@/components/forge/private-financing/PrivateFinancingPageClient";
import { createClient } from "@/lib/supabase/server";

export default async function PrivateFinancingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  return <PrivateFinancingPageClient />;
}
