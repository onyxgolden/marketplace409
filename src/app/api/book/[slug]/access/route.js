import { NextResponse } from "next/server";
import { createPublicReservationClient } from "@/lib/supabase/createPublicReservationClient";

export async function GET(request, { params }) {
  try {
    const { slug } = await params;
    const token = new URL(request.url).searchParams.get("token") || "";
    if (!token) return NextResponse.json({ error: "An access credential is required." }, { status: 400 });
    const { data, error } = await createPublicReservationClient().rpc("get_public_reservation_access", { p_booking_slug: String(slug || "").trim(), p_access_token: token });
    if (error) {
      if (/not found|not available/i.test(error.message || "")) return NextResponse.json({ error: "Reservation access was not found." }, { status: 404 });
      throw error;
    }
    return NextResponse.json({ access: data });
  } catch (error) {
    console.error("Public reservation access failed", { name: error?.name || "Error" });
    return NextResponse.json({ error: "Unable to load reservation access." }, { status: 500 });
  }
}
