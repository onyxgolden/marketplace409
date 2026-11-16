import {
  NextResponse,
} from "next/server";

import {
  headers,
} from "next/headers";

import {
  createForgeApplicationSuite,
} from "@/infrastructure/composition";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  checkForgeAppAccess,
} from "@/lib/supabase/forgeAppAccess";

import {
  resolveEffectiveOwnerId,
} from "@/lib/supabase/resolveEffectiveOwnerId";

// S1 (load-times slice 1): the proxy validates the session once per
// request and carries the validated user in this header (see
// src/proxy.js). The factory trusts it only because the proxy strips
// any client-supplied value first and sets it only after getUser()
// succeeds. Absent header (proxy did not run, validation failed, or a
// non-request context such as a unit test) falls back to getUser()
// exactly as before — the auth decision is unchanged, the same
// server-side validation simply ran once, in the proxy.
const FORGE_AUTH_USER_HEADER = "x-forge-auth-user";

async function readValidatedUserFromHeaders() {
  try {
    const value = (await headers()).get(
      FORGE_AUTH_USER_HEADER,
    );

    if (!value) {
      return null;
    }

    const parsed = JSON.parse(value);

    if (
      !parsed ||
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      return null;
    }

    return {
      id: parsed.id,
      email:
        typeof parsed.email === "string"
          ? parsed.email
          : null,
    };
  } catch {
    return null;
  }
}

// SaaS Auth PR 1: when appKey is given (one of designer / scheduler /
// planner / capture), the request is gated on the workspace being
// active, the app entitlement being active, and the actor holding an
// active membership — enforced by forge_check_app_access, which reads
// auth.uid() server-side. A denial returns { response: 403 }. Callers
// that pass no appKey keep today's behavior (their own permission
// checks still apply); the four app choke points all pass one.
export async function createAuthenticatedForgeApplication({ requestedOwnerId = null, appKey = null } = {}) {
  const supabaseClient =
    await createClient();

  // S1: prefer the user the proxy already validated for this request;
  // fall back to getUser() when the header is absent.
  let user = await readValidatedUserFromHeaders();

  if (!user) {
    const {
      data: {
        user: authedUser,
      },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !authedUser?.id) {
      return {
        response: NextResponse.json(
          {
            error:
              "Authenticated owner id is required.",
          },
          {
            status: 401,
          },
        ),
      };
    }

    user = authedUser;
  }

  // UI-density redesign: a validated ?workspace= selection overrides the
  // default resolution. resolveEffectiveOwnerId honors it only for the
  // actor's own id or an active membership, so an unvalidated value can
  // never widen access. Callers that pass nothing keep today's behavior.
  const effectiveOwnerId =
    await resolveEffectiveOwnerId({
      supabaseClient,
      actorUserId: user.id,
      requestedOwnerId,
    });

  if (appKey) {
    const gate = await checkForgeAppAccess(supabaseClient, effectiveOwnerId, appKey);
    if (!gate.allowed) {
      return { response: gate.response };
    }
  }

  const currentOwnerId =
    async () => effectiveOwnerId;

  let forgeApplicationSuite;

  async function getForgeApplicationSuite() {
    if (!forgeApplicationSuite) {
      forgeApplicationSuite =
        await createForgeApplicationSuite({
          supabaseClient,
          ownerId:
            effectiveOwnerId,
          currentOwnerId,
        });
    }

    return forgeApplicationSuite;
  }

  return {
    supabaseClient,
    user,
    effectiveOwnerId,
    currentOwnerId,
    getForgeApplicationSuite,
  };
}
