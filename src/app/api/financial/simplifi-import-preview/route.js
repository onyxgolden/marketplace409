import { NextResponse } from "next/server";

import { buildSimplifiImportPreview, loadSimplifiOverlapEvidence } from "@/domains/simplifi-import";
import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

const SAFE_FILE_LABEL = /^[^/\\\0]{1,200}$/;

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function validatedCategoryMappings(requestedMappings) {
  const result = {};
  for (const mapping of requestedMappings ?? []) {
    const source = normalized(mapping?.simplifi_category);
    const target = normalized(mapping?.normalized_category).replace(/\s+/g, "_");
    const treatment = normalized(mapping?.treatment || "operating").replace(/\s+/g, "_");
    if (!source || !/^[a-z0-9][a-z0-9_]{0,99}$/.test(target)) {
      throw new Error("Every category mapping requires a Simplifi category and a valid FORGE category.");
    }
    if (result[source]) throw new Error(`Simplifi category ${source} is mapped more than once.`);
    if (!["operating", "transfer", "asset_purchase", "exclude"].includes(treatment)) {
      throw new Error(`Simplifi category ${source} has an invalid reporting treatment.`);
    }
    result[source] = Object.freeze({ normalized_category: target, treatment });
  }
  return Object.freeze(result);
}

function fingerprintSecret() {
  const secret = process.env.SIMPLIFI_FINGERPRINT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Simplifi import fingerprinting is not configured.");
  }
  return secret;
}

export async function POST(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const body = await request.json();
    const csv = typeof body?.csv === "string" ? body.csv : "";
    const fileLabel = String(body?.fileName || "simplifi-transactions.csv").trim();
    if (!csv) return NextResponse.json({ error: "A Simplifi CSV file is required." }, { status: 400 });
    if (!SAFE_FILE_LABEL.test(fileLabel)) {
      return NextResponse.json({ error: "The Simplifi CSV filename is invalid." }, { status: 400 });
    }

    const ownerId = authenticated.user.id;
    const database = authenticated.supabaseClient;
    const [accountsResult, importsResult, overlapEvidence] = await Promise.all([
      database.from("financial_accounts")
        .select("id,type,name")
        .eq("owner_id", ownerId)
        .eq("active", true),
      database.from("financial_events")
        .select("source_record_id")
        .eq("owner_id", ownerId)
        .eq("source_system", "quicken_simplifi_csv")
        .not("source_record_id", "is", null),
      loadSimplifiOverlapEvidence(database, ownerId),
    ]);
    const fetchError = accountsResult.error || importsResult.error;
    if (fetchError) throw fetchError;

    const preview = buildSimplifiImportPreview({
      csv,
      ownerAccounts: accountsResult.data || [],
      requestedMappings: Array.isArray(body?.accountMappings) ? body.accountMappings : [],
      categoryMappings: validatedCategoryMappings(body?.categoryMappings),
      fingerprintSecret: fingerprintSecret(),
      existingFingerprints: (importsResult.data || [])
        .map((row) => row.source_record_id)
        .filter((value) => typeof value === "string" && value.startsWith("v1:")),
      overlapEvidence,
    });

    return NextResponse.json({
      success: true,
      ...preview,
      safe_file_label: fileLabel,
      available_accounts: (accountsResult.data || []).map(({ id, name, type }) => ({ id, name, type })),
    });
  } catch (error) {
    console.error("Simplifi import preview error", error);
    const message = error instanceof Error ? error.message : "Unable to preview Simplifi CSV.";
    const status = /required|invalid|mapped|mapping|unsupported|duplicate|configured/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
