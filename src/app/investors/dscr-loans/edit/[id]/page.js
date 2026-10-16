import Header from "@/components/Header";
import RealEstateWorkspaceNavigation from "@/components/forge/RealEstateWorkspaceNavigation";
import DscrSubmitForm from "@/components/dscr/DscrSubmitForm";
import { createClient } from "@/lib/supabase/server";
import { AdminAuthorizationApplication } from "@/application/business/AdminAuthorizationApplication";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Propose listing edits | DSCR loan providers",
  description:
    "Propose edits to your DSCR lending company listing. Edits are staged for directory review — the live version stays public until approved.",
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient: createSb } = require("@supabase/supabase-js");
  return createSb(url, key, { auth: { persistSession: false } });
}

export default async function DscrEditPage({ params }) {
  const { id } = await params;
  const supabaseServer = await createClient();
  const {
    data: { user },
  } = await supabaseServer.auth.getUser();

  const svc = serviceClient();
  const { data: lender } = svc
    ? await svc.from("dscr_lenders").select("*").eq("id", id).single()
    : { data: null };

  const adminApp = new AdminAuthorizationApplication({ supabase: supabaseServer });
  const adminAuth = await adminApp.loadAdminAuthorization();
  const allowed =
    user && lender && (lender.owner_user_id === user.id || adminAuth.authorized);

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />
      <RealEstateWorkspaceNavigation />

      <section className="max-w-3xl mx-auto py-10 px-6">
        <h1 className="text-3xl font-extrabold">Propose listing edits</h1>

        {!user && (
          <p className="mt-4 text-sm text-gray-600">
            Sign in to propose edits to a listing.
          </p>
        )}

        {user && !lender && (
          <p className="mt-4 text-sm text-gray-600">Listing not found.</p>
        )}

        {user && lender && !allowed && (
          <p className="mt-4 text-sm text-gray-600">
            Only the listing owner or a directory admin can propose edits.
          </p>
        )}

        {allowed && (
          <>
            <p className="text-gray-600 mt-2">
              Editing <span className="font-bold">{lender.company_name}</span>{" "}
              (NMLS {lender.nmls_number}). Your changes are staged for directory
              review — the current live version stays public until an admin
              approves.
            </p>
            <div className="mt-6">
              <DscrSubmitForm
                identityEditable={false}
                submitUrl="/api/dscr-lenders/edit"
                submitLabel="Stage edit for review"
                successTitle="Edit staged for review"
                successBody="Your changes were staged for directory review. The current live version stays public until an administrator approves your changes."
                extraPayload={{ lender_id: lender.id }}
                initialValues={{
                  states_served: lender.states_served ?? [],
                  min_loan_amount:
                    lender.min_loan_amount != null
                      ? String(lender.min_loan_amount)
                      : "",
                  max_loan_amount:
                    lender.max_loan_amount != null
                      ? String(lender.max_loan_amount)
                      : "",
                  property_types: lender.property_types ?? [],
                  transaction_types: lender.transaction_types ?? [],
                  occupancy_entity_restrictions:
                    lender.occupancy_entity_restrictions ?? "",
                  max_ltv:
                    lender.max_ltv != null ? String(lender.max_ltv) : "",
                  min_credit_score_claim:
                    lender.min_credit_score_claim != null
                      ? String(lender.min_credit_score_claim)
                      : "",
                  prepayment_penalty_availability:
                    lender.prepayment_penalty_availability ?? "",
                  min_dscr_accepted:
                    lender.min_dscr_accepted != null
                      ? String(lender.min_dscr_accepted)
                      : "",
                  contact_name: lender.contact_name ?? "",
                  contact_phone: lender.contact_phone ?? "",
                  contact_email: lender.contact_email ?? "",
                  application_url: lender.application_url ?? "",
                }}
                banner={
                  <div className="bg-blue-50 border border-blue-300 rounded-xl p-4 text-sm text-blue-900">
                    Staged edits never replace the live listing silently. A
                    directory admin reviews and approves every material change
                    before it goes public.
                  </div>
                }
              />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
