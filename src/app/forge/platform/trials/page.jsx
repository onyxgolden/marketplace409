import Link from "next/link";
import TrialAdminPanel from "@/components/forge/platform/TrialAdminPanel";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

// Platform-owner trial console (SaaS 30-day trial). A separate surface
// from /forge/developer: the developer page is the programmer gate,
// this page is the owner trial console. Server-side verified identity
// + forge_has_platform_role('owner') on page load; every API request
// re-checks through its own RPC. Non-owners get a non-disclosing
// "not found" page — the console's existence is not advertised to
// client admins. Fails closed until the D6 platform-owner bootstrap
// exists: the operator registry is seeded empty, so nobody passes
// this check until Jason confirms the two owner ids out-of-band.
export default async function PlatformTrialsPage() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) {
    return (
      <main>
        <h1>Trials</h1>
        <p>Sign in to view trials.</p>
      </main>
    );
  }
  const { data: isOwner, error } = await authenticated.supabaseClient.rpc("forge_has_platform_role", {
    p_platform_role: "owner",
  });
  if (error || !isOwner) {
    return (
      <main>
        <h1>Not found</h1>
        <p>The page you are looking for doesn&apos;t exist.</p>
        <p className="mt-1 text-sm">
          <Link href="/forge" className="font-bold underline">
            ← Back to FORGE
          </Link>
        </p>
      </main>
    );
  }
  return (
    <main>
      <p className="mt-1 text-sm">
        <Link href="/forge" className="font-bold underline">
          ← Back to FORGE
        </Link>
      </p>
      <h1>Trials</h1>
      <p>
        Grant 30-day trials for Planner and Capture, renew them after they end, or convert a
        trial to paid/manual access. A trial is one per workspace per app — a workspace that
        already had a trial can&apos;t start a second one. Trials end on their own after 30 days;
        the workspace&apos;s data is kept either way. Converting to paid/manual access is an
        owner-authorized record — it is not proof of payment.
      </p>
      <TrialAdminPanel />
    </main>
  );
}
