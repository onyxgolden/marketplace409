// FORGE Doc-to-Overview — slice B: curator review workbench page.
//
// Authenticated owners only. The store is bound to the effective owner
// id from the session, so the list shows only this owner's drafts.
// Drafts are watermarked DRAFT — NOT VERIFIED until reviewed; export
// is an explicit curator action on approved/kept artifacts only.

import { redirect } from "next/navigation";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { listArtifacts, createDocOverviewStore } from "@/application/doc-overview/generate.js";
import DocOverviewWorkbench from "@/components/forge/docOverview/DocOverviewWorkbench.jsx";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Doc-to-Overview | FORGE",
  description: "Generate, review, and export sourced explainers and infographics from curated documents.",
};

export default async function DocOverviewPage() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) redirect("/auth");
  const store = createDocOverviewStore({ ownerId: authenticated.effectiveOwnerId });
  const { artifacts } = listArtifacts({ store });
  return (
    <main data-doc-overview-page>
      <h1 className="text-2xl font-bold">Doc-to-Overview</h1>
      <p className="mt-1 text-sm text-slate-600">
        Curated explainers and infographics, each claim linked to an admitted source.
        Drafts stay watermarked until a curator reviews them.
      </p>
      <DocOverviewWorkbench initialArtifacts={artifacts} />
    </main>
  );
}
