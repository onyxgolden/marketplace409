import FinancialImportTool from "@/app/import/FinancialImportTool";
import {
  createAuthenticatedForgeApplication,
} from "@/lib/supabase/createAuthenticatedForgeApplication";

export default async function ForgeImportPage() {
  const forgeApplication =
    await createAuthenticatedForgeApplication();

  if (forgeApplication.response) {
    return forgeApplication.response;
  }

  await forgeApplication
    .getForgeApplicationSuite();

  return (
    <main
      data-forge-import-page
      className="min-h-screen bg-slate-100 text-slate-950"
    >
      <FinancialImportTool />
    </main>
  );
}
