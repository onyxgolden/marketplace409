import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { executePfAutopayAttempt, currentBillingPeriod } from "@/application/private-financing/executePfAutopayAttempt";

export const runtime = "nodejs";

// Manual trigger for a single (enrollment, billingPeriod) attempt — same function the
// sweep cron uses. Guarded by a dedicated execution secret, mirroring
// /api/rental/autopay/execute.
export async function POST(request) {
  if (!process.env.PF_AUTOPAY_EXECUTION_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.PF_AUTOPAY_EXECUTION_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const { enrollmentId, billingPeriod } = await request.json();
    const result = await executePfAutopayAttempt(createRentalWebhookClient(), enrollmentId, billingPeriod || currentBillingPeriod());
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error) {
    console.error("Private financing autopay execution error", error);
    return NextResponse.json({ error: "Unable to execute autopay." }, { status: 500 });
  }
}
