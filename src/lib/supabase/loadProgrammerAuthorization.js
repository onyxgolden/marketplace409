import { cache } from "react";

import {
  ProgrammerAuthorizationApplication,
} from "@/application/developer/ProgrammerAuthorizationApplication";

import {
  createClient,
} from "@/lib/supabase/server";

// Per-request memoized: React cache() collapses every call made while
// rendering one request into a single auth.getUser() + forge_is_programmer
// RPC, no matter how many server layouts and pages ask. The forge layout,
// each promoted-workspace layout, the developer page, and the root picker
// all call this for the same request — without the memo each would pay its
// own RPC. cache() is request-scoped, never cross-request, so one user's
// authorization can never leak into another user's render.
export const loadProgrammerAuthorization = cache(
  async function loadProgrammerAuthorization() {
    const supabase =
      await createClient();

    const application =
      new ProgrammerAuthorizationApplication({
        supabase,
      });

    return application
      .loadAuthorization();
  },
);

// Fail-closed boolean form of the check, for layouts that only need to
// decide whether to show the Dev navigation tile: true only when the
// server-validated authorization says ok + authorized; any failure hides
// the tile. Mirrors the inline logic in src/app/forge/layout.js.
export async function isProgrammerAuthorized() {
  try {
    const authorization = await loadProgrammerAuthorization();
    return authorization?.ok === true && authorization?.authorized === true;
  } catch {
    return false;
  }
}
