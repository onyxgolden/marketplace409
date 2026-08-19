import { redirect } from "next/navigation";
import SchedulingBoard from "@/components/forge/scheduling/SchedulingBoard";
import { createClient } from "@/lib/supabase/server";

export default async function SchedulingProjectPage({ params }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  // WBS/Activities are still under active development -- reachable in local dev and preview
  // deploys, held back from the production site until ready. See wbs/page.js and
  // activities/page.js, which enforce the same gate server-side (this only hides the link).
  const wbsEnabled = process.env.VERCEL_ENV !== "production";
  return <SchedulingBoard projectId={projectId} wbsEnabled={wbsEnabled} />;
}
