import Link from "next/link";
import RentalPermissionsPanel from "@/components/forge/rental/RentalPermissionsPanel";
import { createClient } from "@/lib/supabase/server";

// Rental Manager > Settings > Roles & permissions. Owner/co-owner and
// delegated staff-admin surface for the slice-1 role framework: assign
// roles, edit what each role can do, and read the grant/change audit.
// Server component only checks auth; the client component fetches the
// owner-scoped admin API routes. Enforcement lives in the database
// (SECURITY DEFINER RPCs + RLS), not in this page.
export default async function RentalPermissionsSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <main><p>Sign in to view roles &amp; permissions.</p></main>;
  return (
    <main>
      <p className="mt-1 text-sm">
        <Link href="/forge/rental?section=team" className="font-bold underline">
          ← Back to Team &amp; Permissions
        </Link>
      </p>
      <h1>Roles &amp; Permissions</h1>
      <p>
        Roles decide what each staff member can do in the Rental Manager. The owner and co-owner
        always have full access. Billing activation, settings, refunds, and credits stay
        owner/co-owner only — no role can grant them.
      </p>
      <RentalPermissionsPanel />
    </main>
  );
}
