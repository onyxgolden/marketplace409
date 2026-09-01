import { notFound } from "next/navigation";
import UiImprovementManagerPanel from "@/components/forge/developer/UiImprovementManagerPanel";
import { loadProgrammerAuthorization } from "@/lib/supabase/loadProgrammerAuthorization";

export const dynamic = "force-dynamic";

export default async function UiImprovementManagerPage() {
  const authorization = await loadProgrammerAuthorization();

  if (!authorization.ok || !authorization.authorized) {
    notFound();
  }

  return <UiImprovementManagerPanel />;
}
