import Header from "@/components/Header";
import RealEstateWorkspaceNavigation from "@/components/forge/RealEstateWorkspaceNavigation";
import DscrAdminQueue from "@/components/dscr/DscrAdminQueue";
import { createClient } from "@/lib/supabase/server";
import { AdminAuthorizationApplication } from "@/application/business/AdminAuthorizationApplication";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Directory moderation queue | DSCR loan providers",
  description: "Admin review queue for the DSCR loan provider directory.",
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient: createSb } = require("@supabase/supabase-js");
  return createSb(url, key, { auth: { persistSession: false } });
}

export default async function DscrAdminPage() {
  const supabaseServer = await createClient();
  const adminApp = new AdminAuthorizationApplication({ supabase: supabaseServer });
  const adminAuth = await adminApp.loadAdminAuthorization();

  let queue = null;
  if (adminAuth.authorized) {
    const svc = serviceClient();
    if (svc) {
      const [pendingSubmissions, pendingVersions, listings, audit] =
        await Promise.all([
          svc
            .from("dscr_lenders")
            .select(
              "id, company_name, nmls_number, status, identity_review_status, created_at, owner_user_id, states_served, min_loan_amount, max_loan_amount"
            )
            .eq("status", "pending_review")
            .order("created_at", { ascending: true }),
          svc
            .from("dscr_lender_versions")
            .select(
              "id, lender_id, version_number, request_type, payload, submitted_by, created_at, dscr_lenders(company_name)"
            )
            .eq("review_status", "pending")
            .order("created_at", { ascending: true }),
          svc
            .from("dscr_lenders")
            .select(
              "id, company_name, nmls_number, status, identity_review_status, last_directory_reviewed_at, abuse_report_count"
            )
            .order("company_name", { ascending: true }),
          svc
            .from("dscr_lender_audit")
            .select("id, lender_id, action, note, created_at")
            .order("created_at", { ascending: false })
            .limit(50),
        ]);
      queue = {
        pending_submissions: pendingSubmissions.data ?? [],
        pending_versions: pendingVersions.data ?? [],
        listings: listings.data ?? [],
        recent_audit: audit.data ?? [],
      };
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />
      <RealEstateWorkspaceNavigation />

      <section className="max-w-6xl mx-auto py-10 px-6">
        <h1 className="text-3xl font-extrabold">Directory moderation queue</h1>
        <p className="text-gray-600 mt-2 text-sm">
          Admin-only. Every transition is audited; removals are soft
          (unpublished, never deleted); the audit trail is append-only.
        </p>

        {!adminAuth.authorized && (
          <p className="mt-6 text-sm text-gray-600">
            Directory admin access required.
          </p>
        )}

        {adminAuth.authorized && !queue && (
          <p className="mt-6 text-sm text-gray-600">
            Directory service unavailable. Try again later.
          </p>
        )}

        {queue && <DscrAdminQueue initialQueue={queue} />}
      </section>
    </main>
  );
}
