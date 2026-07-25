import { NextResponse } from "next/server";

import {
  ConnectionRepositoryStorage,
  CredentialReferenceRepositoryStorage,
  InstitutionReferenceRepositoryStorage,
  createConnectionPlatformSuite,
} from "@/infrastructure/composition";

import { createClient } from "@/lib/supabase/server";

export async function createAuthenticatedConnectionApplication() {
  const supabaseClient = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabaseClient.auth.getUser();

  if (authError || !user?.id) {
    return {
      response: NextResponse.json(
        {
          error: "Authenticated owner id is required.",
        },
        {
          status: 401,
        },
      ),
    };
  }

  const currentOwnerId = async () => user.id;

  let connectionPlatformSuite;

  async function getConnectionPlatformSuite() {
    if (!connectionPlatformSuite) {
      connectionPlatformSuite =
        await createConnectionPlatformSuite({
          supabaseClient,
          ownerId: user.id,
          currentOwnerId,
          connectionRepositoryStorage:
            ConnectionRepositoryStorage.SUPABASE,
          credentialReferenceRepositoryStorage:
            CredentialReferenceRepositoryStorage.SUPABASE,
          institutionReferenceRepositoryStorage:
            InstitutionReferenceRepositoryStorage.SUPABASE,
        });
    }

    return connectionPlatformSuite;
  }

  return {
    supabaseClient,
    user,
    currentOwnerId,
    getConnectionPlatformSuite,
  };
}
