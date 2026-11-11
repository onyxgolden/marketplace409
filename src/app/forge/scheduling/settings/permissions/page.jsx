import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SchedulingAdminClient from "@/components/forge/scheduling/SchedulingAdminClient";

// Scheduling > Settings > Roles & permissions. Owner/co-owner and
// delegated staff-admin surface for the slice-1 role framework: assign
// roles, edit what each role can do, and read the grant/change audit.
// Server component only checks auth; the client component fetches the
// owner-scoped admin API routes. Enforcement lives in the database
// (SECURITY DEFINER RPCs + RLS), not in this page. Mirrors the Rental
// permissions page's simpler shape (no workspace switcher) rather than
// Planner's -- Scheduling has no workspace-switcher UI anywhere yet
// (PR #773 added the route-layer effective-owner plumbing only), so
// adding one just on this page would be premature scope, not a match
// for this app's actual maturity.
export default async function SchedulingPermissionsSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <main><p>Sign in to view roles &amp; permissions.</p></main>;
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <p className="mt-1 text-sm">
        <Link href="/forge/scheduling" className="font-bold underline">
          ← Back to Scheduling
        </Link>
      </p>
      <h1 className="text-2xl font-bold">Roles &amp; Permissions</h1>
      <p className="mt-1 text-sm text-slate-500">
        Roles decide what each staff member can do in Scheduling. The owner and active co-owner
        always have full access.
      </p>
      <SchedulingAdminClient />
    </main>
  );
}
