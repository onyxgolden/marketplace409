import AnalyticsPrivacyControls from "@/components/analytics/AnalyticsPrivacyControls";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gray-100 text-gray-900 px-6 py-12">
      <article className="mx-auto max-w-4xl rounded-2xl bg-white p-8 shadow">
        <h1 className="text-4xl font-bold mb-6">
          Privacy Policy
        </h1>

        <p className="mb-4">
          Organization: 409 Marketplace LLC
        </p>

        <p className="mb-4">
          Platform: 409 Marketplace / FORGE
        </p>

        <p className="mb-6">
          409 Marketplace respects user privacy and is committed to protecting
          information provided through the platform.
        </p>

        <h2 className="text-2xl font-bold mt-8 mb-3">
          Financial Information
        </h2>

        <p className="mb-4">
          Financial integrations require user authorization. When users
          connect financial accounts, approved providers process connection
          requests and 409 Marketplace receives only information permitted
          through the authorized integration.
        </p>

        <p className="mb-4">
          409 Marketplace does not access financial accounts without user
          authorization through approved connection processes.
        </p>

        <h2 className="text-2xl font-bold mt-8 mb-3">
          Third-Party Providers
        </h2>

        <p>
          409 Marketplace uses third-party providers to provide platform
          functionality, including financial integrations and supporting
          infrastructure services.
        </p>

        <section id="analytics" className="scroll-mt-8">
          <h2 className="text-2xl font-bold mt-8 mb-3">Optional Product Analytics</h2>
          <p className="mb-4">
            With your permission, FORGE sends a small set of anonymous usage events to PostHog in the United States. These events help identify completed onboarding and workflows, broad navigation, feature use, and coded errors.
          </p>
          <p className="mb-4">
            FORGE does not send screen recordings, clicks, typed text, names, email addresses, phone numbers, property addresses, tenant or borrower information, lease content, financial amounts, payment or bank details, Stripe information, authentication secrets, or Supabase records to PostHog.
          </p>
          <p className="mb-4">
            Analytics is optional and disabled unless you choose to allow it. The choice is stored only in this browser and can be changed below at any time.
          </p>
          <AnalyticsPrivacyControls />
        </section>
      </article>
    </main>
  );
}
