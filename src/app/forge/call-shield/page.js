import { redirect } from "next/navigation";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import CallShieldHome from "@/components/forge/callShield/CallShieldHome";

export const metadata = {
  title: "Call Shield | FORGE",
  description: "Log unwanted calls, import your call history automatically from the Android app, and build an evidence packet.",
};

// Slice A: case list + Android call-log import review. Imports land in a
// staging table first; nothing reaches the case timeline until the user
// confirms the association.
export default async function CallShieldPage() {
  const forgeApplication = await createAuthenticatedForgeApplication();
  if (forgeApplication.response) {
    redirect("/auth");
  }

  return (
    <main
      data-forge-call-shield-page
      className="min-h-screen bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100"
    >
      <div className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold">Call Shield</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
          Your unwanted-call evidence kit. Log calls, pull your call history automatically from the
          Call Shield Android app, and keep everything organized per caller — ready to hand to an
          attorney if you ever need one. This is a self-help organization tool, not a lawyer.
        </p>
        <div className="mt-6">
          <CallShieldHome />
        </div>
      </div>
    </main>
  );
}
