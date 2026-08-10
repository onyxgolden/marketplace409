import {
  ProgrammerAuthorizationApplication,
} from "@/application/developer/ProgrammerAuthorizationApplication";

import {
  createClient,
} from "@/lib/supabase/server";

export async function loadProgrammerAuthorization() {
  const supabase =
    await createClient();

  const application =
    new ProgrammerAuthorizationApplication({
      supabase,
    });

  return application
    .loadAuthorization();
}
