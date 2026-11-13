// SaaS Auth PR 1 — read-only access check for app shells / the
// workspace switcher. GET /api/forge/auth/access?app=planner[&owner=...]
import { forgeAuthAccessRoute } from "../_lib/rpcRoute.js";

export async function GET(request) {
  return forgeAuthAccessRoute(request);
}
