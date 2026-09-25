import { redirect } from "next/navigation";
import DesignerScreen from "@/components/designer/DesignerScreen";
import { createClient } from "@/lib/supabase/server";

export default async function DesignerEditorPage({ params }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  const { projectId } = await params;
  return <DesignerScreen projectId={projectId} userId={user.id} />;
}
