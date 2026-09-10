import { NextResponse } from "next/server";

import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

// Every mutating action here is a thin pass-through to a SECURITY DEFINER RPC (see
// supabase/migrations/20260909080000_create_financial_account_groups.sql) -- this route never
// derives or forwards an owner/actor id itself; createAuthenticatedFinancialApplication()
// resolves the real authenticated session, and the RPCs derive owner_id/actor internally via
// resolve_effective_owner_id()/auth.uid() from THAT SAME session's own JWT. A client-supplied
// ownerId/actorUserId would simply be ignored even if sent -- none of the actions below read the
// request body for either.
const ACTIONS = new Set([
  "create_group",
  "add_member",
  "revoke_member",
  "revoke_group",
  "set_balance_authority",
  "set_transaction_authority",
  "advance_coverage_status",
  "set_transaction_cutover",
]);

export async function GET() {
  try {
    const authenticatedApplication = await createAuthenticatedFinancialApplication();
    if (authenticatedApplication.response) return authenticatedApplication.response;

    const suite = await authenticatedApplication.getFinancialApplicationSuite();
    const ownerId = await authenticatedApplication.currentOwnerId();
    const groups = await suite.financialAccountGroupRepository.findActiveGroupsForOwner(ownerId);

    return NextResponse.json({ success: true, data: { groups } });
  } catch (error) {
    console.error("Financial account groups list error", error);
    const message = error instanceof Error ? error.message : "Unable to load financial account groups.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticatedApplication = await createAuthenticatedFinancialApplication();
    if (authenticatedApplication.response) return authenticatedApplication.response;

    const body = await request.json();
    const action = typeof body?.action === "string" ? body.action : "";

    if (!ACTIONS.has(action)) {
      return NextResponse.json({ error: "A supported action is required." }, { status: 400 });
    }

    const suite = await authenticatedApplication.getFinancialApplicationSuite();
    const repository = suite.financialAccountGroupRepository;

    let data;
    switch (action) {
      case "create_group":
        data = await repository.createGroup({
          canonicalFinancialAccountId: String(body.canonicalFinancialAccountId || ""),
          note: body.note ?? null,
        });
        break;
      case "add_member":
        data = await repository.addMember({
          groupId: String(body.groupId || ""),
          financialAccountId: String(body.financialAccountId || ""),
        });
        break;
      case "revoke_member":
        await repository.revokeMember({ memberId: String(body.memberId || "") });
        data = { revoked: true };
        break;
      case "revoke_group":
        await repository.revokeGroup({ groupId: String(body.groupId || "") });
        data = { revoked: true };
        break;
      case "set_balance_authority":
        data = await repository.setBalanceAuthority({
          groupId: String(body.groupId || ""),
          financialAccountId: String(body.financialAccountId || ""),
        });
        break;
      case "set_transaction_authority":
        data = await repository.setTransactionAuthority({
          groupId: String(body.groupId || ""),
          financialAccountId: String(body.financialAccountId || ""),
        });
        break;
      case "advance_coverage_status":
        data = await repository.advanceCoverageStatus({
          groupId: String(body.groupId || ""),
          newStatus: String(body.newStatus || ""),
          note: body.note ?? null,
        });
        break;
      case "set_transaction_cutover":
        data = await repository.setTransactionCutover({
          groupId: String(body.groupId || ""),
          cutoverDate: String(body.cutoverDate || ""),
        });
        break;
      default:
        return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Financial account groups operation error", { name: error instanceof Error ? error.name : "Error" });
    // Postgres RAISE EXCEPTION messages from the RPCs (e.g. "This account already belongs to an
    // active group.", "Not authorized for this workspace.") are safe, deliberately user-facing
    // strings -- never internal detail -- so they are surfaced verbatim rather than replaced with
    // a generic message.
    const message = error instanceof Error ? error.message : "Unable to complete the financial account group operation.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
