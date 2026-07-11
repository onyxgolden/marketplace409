import Header from "@/components/Header";
import BusinessClaimActions from "@/components/BusinessClaimActions";

import { BusinessClaimApplication } from "@/application/business";
import { BusinessClaimRepository } from "@/domains/business-claims/business-claim.repository";
import { BusinessClaimService } from "@/domains/business-claims/business-claim.service";

export const dynamic = "force-dynamic";

const businessClaimApplication = new BusinessClaimApplication({
  service: new BusinessClaimService(new BusinessClaimRepository()),
});

export default async function BusinessClaimsAdminPage() {
  const result = await businessClaimApplication.loadClaims();

  const claims = result.claims;
  const error = result.ok ? null : { message: result.message };

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-7xl mx-auto py-10 px-6">
        <h1 className="text-4xl font-extrabold mb-2">Business Claims</h1>

        <p className="text-gray-600 mb-8">
          Review claim requests from business owners.
        </p>

        {error && (
          <div className="bg-red-100 text-red-800 p-4 rounded-xl mb-6">
            {error.message}
          </div>
        )}

        {!claims.length ? (
          <div className="bg-white rounded-2xl shadow p-8 text-center">
            <p className="text-gray-600">No business claims yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {claims.map((claim) => (
              <div
                key={claim.id}
                className="bg-white rounded-2xl shadow p-6 border"
              >
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold">
                      {claim.business_name}
                    </h2>

                    <p className="text-sm text-gray-500 mt-1">
                      Status:{" "}
                      <span className="font-bold uppercase">
                        {claim.status}
                      </span>
                    </p>
                  </div>

                  <a
                    href={`/businesses/${claim.business_id}`}
                    className="bg-blue-700 text-white px-4 py-2 rounded-xl font-bold hover:bg-blue-600 text-center"
                  >
                    View Business
                  </a>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 text-sm">
                  <div>
                    <p className="font-bold">Claimant</p>
                    <p>{claim.claimant_name}</p>
                  </div>

                  <div>
                    <p className="font-bold">Title / Position</p>
                    <p>{claim.title || "Not provided"}</p>
                  </div>

                  <div>
                    <p className="font-bold">Email</p>
                    <p>{claim.email}</p>
                  </div>

                  <div>
                    <p className="font-bold">Phone</p>
                    <p>{claim.phone}</p>
                  </div>

                  <div>
                    <p className="font-bold">Website</p>
                    <p>{claim.website || "Not provided"}</p>
                  </div>

                  <div>
                    <p className="font-bold">Facebook</p>
                    <p>{claim.facebook_url || "Not provided"}</p>
                  </div>
                </div>

                {claim.notes && (
                  <div className="mt-5">
                    <p className="font-bold text-sm">Notes</p>

                    <p className="text-gray-700 whitespace-pre-wrap">
                      {claim.notes}
                    </p>
                  </div>
                )}

                <div className="mt-6 flex flex-wrap gap-3">
                  <a
                    href={`tel:${claim.phone}`}
                    className="bg-green-700 text-white px-4 py-2 rounded-xl font-bold hover:bg-green-600"
                  >
                    Call Claimant
                  </a>

                  <a
                    href={`mailto:${claim.email}`}
                    className="bg-gray-900 text-white px-4 py-2 rounded-xl font-bold hover:bg-gray-800"
                  >
                    Email Claimant
                  </a>

                  <BusinessClaimActions claim={claim} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
