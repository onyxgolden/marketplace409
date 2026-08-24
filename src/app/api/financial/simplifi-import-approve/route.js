import { NextResponse } from "next/server";

import { buildSimplifiImportPreview, loadSimplifiOverlapEvidence } from "@/domains/simplifi-import";
import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function categoryMappings(requestedMappings) {
  const result = {};
  for (const mapping of requestedMappings ?? []) {
    const source = normalized(mapping?.simplifi_category);
    const target = normalized(mapping?.normalized_category).replace(/\s+/g, "_");
    const treatment = normalized(mapping?.treatment || "operating").replace(/\s+/g, "_");
    if (!source || !/^[a-z0-9][a-z0-9_]{0,99}$/.test(target) || result[source]
      || !["operating", "transfer", "asset_purchase", "exclude"].includes(treatment)) {
      throw new Error("Category mappings are incomplete or duplicated. Re-preview the file.");
    }
    result[source] = { normalized_category: target, treatment };
  }
  return result;
}

function secret() {
  const value = process.env.SIMPLIFI_FINGERPRINT_SECRET;
  if (!value || value.length < 32) throw new Error("Simplifi import fingerprinting is not configured.");
  return value;
}

export async function POST(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const body = await request.json();
    const csv = typeof body?.csv === "string" ? body.csv : "";
    const expectedBatchHash = String(body?.batchHash || "");
    const expectedPreviewHash = String(body?.previewHash || "");
    const selected = Array.isArray(body?.selectedFingerprints) ? [...new Set(body.selectedFingerprints)] : [];
    if (!csv || !/^[0-9a-f]{64}$/.test(expectedBatchHash) || !/^[0-9a-f]{64}$/.test(expectedPreviewHash)) {
      return NextResponse.json({ error: "The original CSV and valid preview evidence are required." }, { status: 400 });
    }
    if (selected.length === 0 || selected.length > 500 || selected.some((value) => !/^v1:[0-9a-f]{64}$/.test(value))) {
      return NextResponse.json({ error: "Select between 1 and 500 valid preview rows." }, { status: 400 });
    }

    const ownerId = authenticated.user.id;
    const database = authenticated.supabaseClient;
    const [accountsResult, importsResult, overlapEvidence] = await Promise.all([
      database.from("financial_accounts").select("id,type,name").eq("owner_id", ownerId).eq("active", true),
      database.from("financial_events").select("source_record_id")
        .eq("owner_id", ownerId).eq("source_system", "quicken_simplifi_csv").not("source_record_id", "is", null),
      loadSimplifiOverlapEvidence(database, ownerId),
    ]);
    const fetchError = accountsResult.error || importsResult.error;
    if (fetchError) throw fetchError;

    const fresh = buildSimplifiImportPreview({
      csv,
      ownerAccounts: accountsResult.data || [],
      requestedMappings: Array.isArray(body?.accountMappings) ? body.accountMappings : [],
      categoryMappings: categoryMappings(body?.categoryMappings),
      fingerprintSecret: secret(),
      existingFingerprints: (importsResult.data || []).map((row) => row.source_record_id).filter(Boolean),
      overlapEvidence,
    });
    if (fresh.batch_hash !== expectedBatchHash) {
      return NextResponse.json({ error: "The file, mappings, or source evidence changed. Run a new preview before approving." }, { status: 409 });
    }

    const byFingerprint = new Map(fresh.rows.map((row) => [row.fingerprint, row]));
    const rows = selected.map((fingerprint) => byFingerprint.get(fingerprint));
    if (
      fresh.preview_hash !== expectedPreviewHash &&
      rows.every((row) => row?.classification === "already_imported")
    ) {
      return NextResponse.json({
        success: true,
        result: { applied: 0, already_applied: rows.length },
      });
    }
    if (fresh.preview_hash !== expectedPreviewHash) {
      return NextResponse.json({ error: "The file, mappings, or source evidence changed. Run a new preview before approving." }, { status: 409 });
    }
    if (rows.some((row) => !row || row.classification !== "safe_missing" || !row.approvable)) {
      return NextResponse.json({ error: "One or more selected rows are no longer safe to import. Run a new preview." }, { status: 409 });
    }

    const { data, error } = await database.rpc("approve_simplifi_csv_import", {
      p_owner_id: ownerId,
      p_file_hash: fresh.batch_hash,
      p_safe_file_label: String(body?.fileName || "simplifi-transactions.csv").replace(/[/\\\0]/g, "_").slice(0, 200),
      p_preview_hash: fresh.preview_hash,
      p_rows: rows.map((row) => ({
        fingerprint: row.fingerprint,
        evidence_hash: row.evidence_hash,
        financial_account_id: row.account_mapping_id,
        event_date: row.date,
        signed_amount_cents: row.amount_cents,
        normalized_category: row.normalized_category,
        transaction_kind: row.transaction_kind,
        affects_noi: row.affects_noi,
        capitalized: row.capitalized,
        classification: row.classification,
        description: row.payee,
      })),
    });
    if (error) throw error;
    return NextResponse.json({ success: true, result: data });
  } catch (error) {
    console.error("Simplifi import approval error", error);
    const message = error instanceof Error ? error.message : "Unable to approve Simplifi import.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
