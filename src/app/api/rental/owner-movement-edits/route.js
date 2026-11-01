import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

// GET /api/rental/owner-movement-edits?movementId= — the edit trail for one
// owner cash movement (G13). Owner-scoped twice: the movement must belong to
// the workspace, and the edits must too. Newest first. Until migration
// 20261101020000 applies, this table does not exist and the query fails
// plainly — the panel only offers "View edits" when the movements list
// already reported edits, so this path is unreachable pre-migration.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const movementId = String(new URL(request.url).searchParams.get("movementId") || "").trim();
    if (!movementId) return NextResponse.json({ error: "movementId is required." }, { status: 400 });

    const { data: movement, error: movementError } = await supabaseClient
      .from("owner_cash_movements")
      .select("id")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", movementId)
      .single();
    if (movementError || !movement) {
      return NextResponse.json({ error: "Owner movement not found." }, { status: 404 });
    }

    const { data, error } = await supabaseClient
      .from("owner_cash_movement_edits")
      .select("id, movement_id, edited_by, edited_at, old_amount, new_amount, old_movement_date, new_movement_date, old_method, new_method, old_memo, new_memo")
      .eq("owner_id", effectiveOwnerId)
      .eq("movement_id", movementId)
      .order("edited_at", { ascending: false });
    if (error) throw error;

    return NextResponse.json({
      success: true,
      edits: (data || []).map((row) => ({
        id: row.id,
        movementId: row.movement_id,
        editedBy: row.edited_by || null,
        editedAt: row.edited_at || null,
        oldAmount: Number(row.old_amount),
        newAmount: Number(row.new_amount),
        oldMovementDate: row.old_movement_date,
        newMovementDate: row.new_movement_date,
        oldMethod: row.old_method,
        newMethod: row.new_method,
        oldMemo: row.old_memo || "",
        newMemo: row.new_memo || "",
      })),
    });
  } catch (error) {
    console.error("Owner movement edits load error", error);
    return NextResponse.json({ error: "Unable to load the edit history." }, { status: 500 });
  }
}
