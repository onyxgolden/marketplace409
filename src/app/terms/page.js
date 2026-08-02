export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gray-100 text-gray-900 px-6 py-12">
      <article className="mx-auto max-w-4xl rounded-2xl bg-white p-8 shadow">
        <h1 className="text-4xl font-bold mb-6">
          Terms of Service
        </h1>

        <p className="mb-4">
          Organization: 409 Marketplace LLC
        </p>

        <p className="mb-6">
          These Terms of Service govern access to and use of
          409 Marketplace applications and services.
        </p>

        <h2 className="text-2xl font-bold mt-8 mb-3">
          Financial Connections
        </h2>

        <p className="mb-4">
          Financial integrations require user authorization. Third-party
          providers may process connection requests, and 409 Marketplace only
          accesses information permitted through authorized integrations.
        </p>

        <h2 className="text-2xl font-bold mt-8 mb-3">
          Financial Information Disclaimer
        </h2>

        <p>
          409 Marketplace provides software tools and reporting functionality.
          The platform does not provide financial, investment, tax, or legal
          advice.
        </p>
      </article>
    </main>
  );
}
