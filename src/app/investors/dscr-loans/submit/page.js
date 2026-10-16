import Header from "@/components/Header";
import RealEstateWorkspaceNavigation from "@/components/forge/RealEstateWorkspaceNavigation";
import DscrSubmitForm from "@/components/dscr/DscrSubmitForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "List your DSCR lending company | 409 Marketplace",
  description:
    "Submit your DSCR lending company for the 409 Marketplace provider directory. All submissions are reviewed before publication.",
};

export default function DscrSubmitPage() {
  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />
      <RealEstateWorkspaceNavigation />

      <section className="max-w-3xl mx-auto py-10 px-6">
        <h1 className="text-3xl font-extrabold">List your DSCR lending company</h1>
        <p className="text-gray-600 mt-2">
          Reach investment-property borrowers on 409 Marketplace. Submissions
          are reviewed by our directory team before anything goes public —
          nothing appears automatically.
        </p>
        <div className="mt-6">
          <DscrSubmitForm />
        </div>
      </section>
    </main>
  );
}
