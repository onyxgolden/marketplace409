import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { inferSimplifiAccountType, parseSimplifiCsv } from "@/domains/simplifi-import";
import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

const MAXIMUM_ACCOUNTS = 500;
const normalized = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);

export async function POST(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const body = await request.json();
    const csv = typeof body?.csv === "string" ? body.csv : "";
    if (!csv) return NextResponse.json({ error: "A Simplifi CSV file is required." }, { status: 400 });

    const parsed = parseSimplifiCsv(csv);
    const names = [...new Set(parsed.rows.map((row) => row.account_name))];
    if (names.length > MAXIMUM_ACCOUNTS) {
      return NextResponse.json({ error: `Simplifi account creation is limited to ${MAXIMUM_ACCOUNTS} accounts.` }, { status: 400 });
    }

    const ownerId = authenticated.user.id;
    const database = authenticated.supabaseClient;
    const existingResult = await database.from("financial_accounts")
      .select("id,name,type")
      .eq("owner_id", ownerId)
      .eq("active", true);
    if (existingResult.error) throw existingResult.error;

    const existingByName = new Map((existingResult.data || []).map((account) => [normalized(account.name), account]));
    const timestamp = new Date().toISOString();
    const missing = names.filter((name) => !existingByName.has(normalized(name)));
    const rows = missing.map((name) => {
      const identity = digest(`${ownerId}\0${normalized(name)}`);
      return {
        id: `financial_account_simplifi_${identity}`,
        owner_id: ownerId,
        connection_id: "quicken_simplifi_csv",
        provider: "quicken_simplifi_csv",
        provider_account_id: `simplifi:${identity}`,
        institution_id: "quicken_simplifi",
        name,
        official_name: null,
        mask: null,
        type: inferSimplifiAccountType(name),
        subtype: "csv_import",
        currency_code: "USD",
        active: true,
        created_at: timestamp,
        updated_at: timestamp,
      };
    });

    if (rows.length) {
      const saved = await database.from("financial_accounts")
        .upsert(rows, { onConflict: "owner_id,provider,provider_account_id" });
      if (saved.error) throw saved.error;
    }

    return NextResponse.json({ success: true, created: rows.length, reused: names.length - rows.length });
  } catch (error) {
    console.error("Simplifi account bootstrap error", error);
    const message = error instanceof Error ? error.message : "Unable to create Simplifi accounts.";
    return NextResponse.json({ error: message }, { status: /required|invalid|limited/i.test(message) ? 400 : 500 });
  }
}
