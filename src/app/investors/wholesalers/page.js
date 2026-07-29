import Header from "@/components/Header";
import RealEstateWorkspaceNavigation from "@/components/forge/RealEstateWorkspaceNavigation";
import DeleteWholesalerButton from "@/components/DeleteWholesalerButton";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function WholesalersPage({ searchParams }) {
  const params = await searchParams;
  const q = (params?.q || "").trim();
  const type = (params?.type || "").trim();
  const area = (params?.area || "").trim();

  let query = supabase
    .from("investor_wholesalers")
    .select("*")
    .order("created_at", { ascending: false });

  if (q) {
    query = query.or(
      `name.ilike.%${q}%,company_name.ilike.%${q}%,notes.ilike.%${q}%,deal_types.ilike.%${q}%,buyer_types.ilike.%${q}%`,
    );
  }

  if (type) {
    query = query.ilike("contact_type", `%${type}%`);
  }

  if (area) {
    query = query.or(
      `city.ilike.%${area}%,counties_served.ilike.%${area}%,service_area.ilike.%${area}%`,
    );
  }

  const { data: wholesalers, error } = await query;

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />
      <RealEstateWorkspaceNavigation />

      <section className="max-w-6xl mx-auto py-12 px-6">
        <h1 className="text-5xl font-extrabold mb-4">Investor Wholesalers</h1>

        <p className="text-xl text-gray-600 mb-8">
          Local wholesalers, deal finders, bird dogs, and investor contacts.
        </p>

        <div className="flex flex-col md:flex-row gap-3 mb-8">
          <a
            href="/investors/wholesalers/add"
            className="inline-block bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-500 text-center"
          >
            Add Wholesaler Contact
          </a>

          {(q || type || area) && (
            <a
              href="/investors/wholesalers"
              className="inline-block bg-gray-800 text-white px-6 py-3 rounded-xl font-bold hover:bg-gray-700 text-center"
            >
              Clear Filters
            </a>
          )}
        </div>

        <form
          action="/investors/wholesalers"
          className="bg-white rounded-2xl shadow-md p-5 mb-8 grid grid-cols-1 md:grid-cols-4 gap-4"
        >
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name, company, notes..."
            className="rounded-xl border p-3 md:col-span-2"
          />

          <input
            name="area"
            defaultValue={area}
            placeholder="Area/county/city"
            className="rounded-xl border p-3"
          />

          <select
            name="type"
            defaultValue={type}
            className="rounded-xl border p-3"
          >
            <option value="">All contact types</option>
            <option value="Wholesaler">Wholesaler</option>
            <option value="Bird Dog">Bird Dog</option>
            <option value="Investor">Investor</option>
            <option value="Realtor">Realtor</option>
            <option value="Contractor">Contractor</option>
            <option value="Lender">Lender</option>
            <option value="Other">Other</option>
          </select>

          <button
            type="submit"
            className="bg-blue-800 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 md:col-span-4"
          >
            Search / Filter
          </button>
        </form>

        {error && (
          <div className="bg-red-100 text-red-700 p-4 rounded-xl mb-6">
            Could not load wholesaler contacts.
          </div>
        )}

        {!wholesalers || wholesalers.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">
              No wholesaler contacts found
            </h2>

            <p className="text-gray-600">
              Try clearing filters or adding your first investor contact.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm font-bold text-gray-600">
              Showing {wholesalers.length} contact
              {wholesalers.length === 1 ? "" : "s"}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {wholesalers.map((contact) => (
                <div
                  key={contact.id}
                  className="bg-white rounded-2xl shadow-md p-5"
                >
                  <h2 className="text-2xl font-bold">{contact.name}</h2>

                  {contact.company_name && (
                    <p className="text-blue-900 font-bold mt-1">
                      {contact.company_name}
                    </p>
                  )}

                  {contact.city && (
                    <p className="text-gray-500 mt-2">{contact.city}</p>
                  )}

                  {contact.contact_type && (
                    <p className="mt-3">
                      <strong>Contact Type:</strong> {contact.contact_type}
                    </p>
                  )}

                  {contact.counties_served && (
                    <p className="mt-2">
                      <strong>Counties Served:</strong>{" "}
                      {contact.counties_served}
                    </p>
                  )}

                  {contact.community_contact && (
                    <span className="inline-block mt-3 bg-orange-100 text-orange-900 px-3 py-1 rounded-full text-sm font-bold">
                      🤝 Community Contact
                    </span>
                  )}

                  {contact.service_area && (
                    <p className="mt-4">
                      <strong>Service Area:</strong> {contact.service_area}
                    </p>
                  )}

                  {contact.deal_types && (
                    <p className="mt-2">
                      <strong>Deals:</strong> {contact.deal_types}
                    </p>
                  )}

                  {contact.buyer_types && (
                    <p className="mt-2">
                      <strong>Buyer Types:</strong> {contact.buyer_types}
                    </p>
                  )}

                  {contact.notes && (
                    <div className="mt-4 text-gray-600">{contact.notes}</div>
                  )}

                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone}`}
                      className="block mt-4 bg-green-700 text-white text-center py-3 rounded-xl font-bold"
                    >
                      Call
                    </a>
                  )}

                  {contact.phone && (
                    <a
                      href={`sms:${contact.phone}`}
                      className="block mt-3 bg-blue-900 text-white text-center py-3 rounded-xl font-bold"
                    >
                      Text
                    </a>
                  )}

                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="block mt-3 bg-gray-800 text-white text-center py-3 rounded-xl font-bold"
                    >
                      Email
                    </a>
                  )}

                  <a
                    href={`/investors/wholesalers/edit/${contact.id}`}
                    className="block mt-3 bg-purple-700 text-white text-center py-3 rounded-xl font-bold"
                  >
                    Edit Contact
                  </a>

                  <DeleteWholesalerButton wholesalerId={contact.id} />
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
