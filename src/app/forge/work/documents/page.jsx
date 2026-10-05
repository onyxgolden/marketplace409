import { redirect } from "next/navigation";
import Link from "next/link";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { listDocuments } from "@/application/work-management/workDocuments";
import DocumentLibraryClient from "@/components/work-management/DocumentLibraryClient";

export const dynamic = "force-dynamic";

export default async function DocumentLibraryPage() {
  const forgeApplication = await createAuthenticatedForgeApplication();
  if (forgeApplication.response) redirect("/auth");

  let documents = [];
  try {
    documents = await listDocuments(forgeApplication.supabaseClient, forgeApplication.effectiveOwnerId, {});
  } catch {
    documents = [];
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">
            <Link href="/forge/work" className="hover:underline">Work Packages</Link>
            {" / "}Document library
          </p>
          <h1 className="mt-1 text-2xl font-bold">Document library</h1>
          <p className="mt-1 text-sm text-slate-500">
            This planner's own documents — templates to fill out, filled forms,
            and reference material. Drawings live in the Designer and are linked
            from each package.
          </p>
        </div>
      </div>
      <DocumentLibraryClient initialDocuments={documents} />
    </main>
  );
}
