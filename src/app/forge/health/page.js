import { redirect } from "next/navigation";
import HealthDashboard from "@/components/forge/health/HealthDashboard";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Private Health | FORGE" };

export default async function HealthPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  const { data: membership } = await supabase.from("health_workspace_members").select("workspace_id,role").eq("user_id", user.id).maybeSingle();
  return <HealthDashboard initialMembership={membership} />;
}
