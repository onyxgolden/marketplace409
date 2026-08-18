import { redirect } from "next/navigation";
import SchedulingBoard from "@/components/forge/scheduling/SchedulingBoard";
import { createClient } from "@/lib/supabase/server";

export default async function SchedulingProjectPage({ params }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  return <SchedulingBoard projectId={projectId} />;
}
