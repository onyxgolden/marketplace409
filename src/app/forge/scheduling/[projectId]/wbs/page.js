import { redirect } from "next/navigation";
import WbsPage from "@/components/forge/scheduling/WbsPage";
import { createClient } from "@/lib/supabase/server";

export default async function SchedulingWbsPage({ params }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  return <WbsPage projectId={projectId} />;
}
