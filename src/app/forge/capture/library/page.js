import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import CaptureLibraryGrid from "@/components/forge/capture/CaptureLibraryGrid";

export const metadata = {
  title: "Capture Library | FORGE",
  description:
    "Your opt-in FORGE capture library. Captures land here only when you press Save to FORGE in the desktop app — nothing uploads automatically.",
};

// FORGE Capture Rung 6 — web entry point for the capture library.
// ?capture=<id> (the desktop app's deep link) highlights that item.
export default async function CaptureLibraryPage({ searchParams }) {
  const forgeApplication = await createAuthenticatedForgeApplication();
  if (forgeApplication.response) {
    return forgeApplication.response;
  }

  const params = await searchParams;
  const highlightId = typeof params?.capture === "string" && params.capture ? params.capture : null;

  return (
    <main
      data-forge-capture-library-page
      className="min-h-screen bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100"
    >
      <div className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold">Capture Library</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
          Your opt-in FORGE storage. Captures appear here only when you press{" "}
          <span className="font-semibold">Save to FORGE</span> in the FORGE Capture desktop app — nothing uploads
          automatically, and there is no background sync.
        </p>
        <div className="mt-6">
          <CaptureLibraryGrid highlightId={highlightId} />
        </div>
      </div>
    </main>
  );
}
