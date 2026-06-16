import Header from "@/components/Header";
import DeleteWholesalerButton from "@/components/DeleteWholesalerButton";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function WholesalersPage() {
  const { data: wholesalers, error } = await supabase
    .from("investor_wholesalers")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-6xl mx-auto py-12 px-6">
        <h1 className="text-5xl font-extrabold mb-4">Investor Wholesalers</h1>

        <p className="text-xl text-gray-600 mb-8">
          Local wholesalers, deal finders, bird dogs, and investor contacts.
        </p>

        <a
          href="/investors/wholesalers/add"
          className="inline-block bg-red-600 text-white px-6 py-3 rounded-xl font-bold mb-8 hover:bg-red-500"
        >
          Add Wholesaler Contact
        </a>

        {error && (
          <div className="bg-red-100 text-red-700 p-4 rounded-xl mb-6">
            Could not load wholesaler contacts.
          </div>
        )}

        {!wholesalers || wholesalers.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">
              No wholesaler contacts yet
            </h2>

            <p className="text-gray-600">Add your first investor contact.</p>
          </div>
        ) : (
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
                    <strong>Counties Served:</strong> {contact.counties_served}
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
        )}
      </section>
    </main>
  );
}
