import Header from "@/components/Header";
import HomeFooter from "@/components/home/HomeFooter";

export const metadata = {
  title: "Page Not Found | 409 Marketplace",
  description:
    "The page you were looking for could not be found. Head back to the 409 Marketplace homepage or browse local listings.",
};

// Branded 404: matches the dark-slate/amber marketplace look and gives the
// visitor useful ways back instead of the framework default page.
export default function NotFound() {
  return (
    <main className="min-h-screen bg-gray-100 text-gray-900 dark:bg-slate-950 flex flex-col">
      <Header />

      <section className="flex-1 flex items-center justify-center px-6 py-24">
        <div className="max-w-2xl mx-auto text-center">
          <div className="text-sm font-black uppercase tracking-[0.3em] text-amber-500 mb-4">
            409 Marketplace
          </div>
          <h1 className="text-6xl font-extrabold mb-6 dark:text-white">
            Lost in the 409?
          </h1>
          <p className="text-xl text-slate-600 dark:text-slate-300 mb-10">
            That page doesn&apos;t exist or was moved. Let&apos;s get you back
            to the good stuff.
          </p>

          <div className="flex flex-wrap justify-center gap-4">
            <a
              href="/market"
              className="bg-amber-500 text-slate-950 px-6 py-3 rounded-xl text-lg font-semibold hover:bg-amber-400"
            >
              Back to Marketplace
            </a>
            <a
              href="/browse"
              className="bg-white text-slate-950 px-6 py-3 rounded-xl text-lg font-semibold hover:bg-slate-100 border border-slate-200"
            >
              Browse Listings
            </a>
          </div>
        </div>
      </section>

      <HomeFooter />
    </main>
  );
}
