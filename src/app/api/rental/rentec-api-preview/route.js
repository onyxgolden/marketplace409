import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentecApiClient } from "@/domains/rentec-rental-migration/rentec-api.client";

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const body = await request.json();
    const client = createRentecApiClient();
    if (body?.operation === "inventory") return NextResponse.json({ success: true, data: await client.inventory() });
    if (body?.operation === "transactions") return NextResponse.json({ success: true, data: await client.transactionPage({ propertyId: String(body.propertyId || ""), page: Number(body.page || 1) }) });
    if (body?.operation === "files") return NextResponse.json({ success: true, data: await client.fileInventory({ associationType: String(body.associationType || "all"), associationId: String(body.associationId || "") }) });
    return NextResponse.json({ error: "A supported Rentec preview operation is required." }, { status: 400 });
  } catch (error) {
    console.error("Rentec API preview error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to preview Rentec data." }, { status: 500 });
  }
}
