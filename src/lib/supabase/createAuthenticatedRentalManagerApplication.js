import { RentalManagerApplication } from "@/application/rental";
import { createRentalManagerRepositories } from "@/infrastructure/composition";
import { createAuthenticatedForgeApplication } from "./createAuthenticatedForgeApplication";

export async function createAuthenticatedRentalManagerApplication() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated;
  const repositories = await createRentalManagerRepositories({ storage: "supabase", supabaseClient: authenticated.supabaseClient });
  return Object.freeze({ supabaseClient: authenticated.supabaseClient, user: authenticated.user,
    application: new RentalManagerApplication(repositories) });
}
