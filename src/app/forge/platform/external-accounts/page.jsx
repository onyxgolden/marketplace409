import Link from "next/link";
import ExternalAccountsPanel from "@/components/forge/platform/ExternalAccountsPanel";
import { isRegisterHouseholdActor } from "@/domains/externalAccounts/externalAccountHouseholdGate";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

// FORGE External Accounts Register — owner-only page at
// /forge/platform/external-accounts (the repo's established
// owner-admin convention is /forge/platform/*, e.g. the trials
// console; the brief permits that convention).
//
// Server-side verified household actor (Jason + Brandy) on page load;
// every API request re-checks through the household gate + the DB
// RLS/RPC gates. Non-household callers get a non-disclosing
// "not found" page — the register's existence is not advertised.
//
// Deliberately NOT gated on forge_has_platform_role('owner'): the D6
// platform-owner registry is seeded empty and fails closed for
// everyone until Jason confirms the two owner ids out-of-band, so
// that check would lock Jason himself out of his own register.
export default async function ExternalAccountsPage() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) {
    return (
      <main>
        <h1>External accounts</h1>
        <p>Sign in to view external accounts.</p>
      </main>
    );
  }
  const allowed = await isRegisterHouseholdActor({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user?.id,
  });
  if (!allowed) {
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
      <h1>External accounts</h1>
      <p>
        Every outside account FORGE depends on — who provides it, what it is for, which app uses
        it, whether it is set up, and what work is waiting on it. Only you and your co-owner can
        see this page. Never put a password, API key, or token here: the credential location is
        a pointer to where the login lives (like “1Password → FORGE”), never the secret itself.
      </p>
      <ExternalAccountsPanel />
    </main>
  );
}
