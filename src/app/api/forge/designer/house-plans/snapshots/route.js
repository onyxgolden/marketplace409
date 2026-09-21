import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { isHousePlansEnabled } from "@/lib/housePlans/housePlansFlags";
import { createRegulatorySnapshot } from "@/lib/housePlans/regulatorySnapshot";

// HOUSE PLANS (HP-L4) — immutable Regulatory Snapshots API.
//
// A snapshot captures the reference-library state (which regulatory source
// records, their factual metadata, retrieval/verification dates) at a point
// in time. This API is CREATION-ONLY by design:
//
//   - GET lists snapshots newest-first (read-only).
//   - POST captures a NEW snapshot from the caller's current library.
//   - There are intentionally NO PUT/PATCH/DELETE handlers: snapshots are
//     immutable and append-only. Newer data triggers a new snapshot row; it
//     never silently rewrites a historical one.
//   - If the library is unchanged since the latest snapshot, POST reuses the
//     latest row (created: false) instead of stacking identical history.
//     This is a best-effort convenience, not strict duplicate prevention:
//     two concurrent POSTs can both observe the same latest row and both
//     insert.
//
// Link-only scope: snapshots expose FACTUAL METADATA ONLY (titles, section
// identifiers, issuing authority/jurisdiction, edition/effective dates,
// official URLs, topic tags, provenance, retrieval/verification dates,
// jurisdiction state). The tables have no summary/content/explanation
// columns and this route selects none.

// Factual metadata columns read from the live library when capturing.
const REFERENCE_COLUMNS = [
  "id",
  "title",
  "section_identifier",
  "issuing_authority",
  "jurisdiction",
  "edition",
  "effective_date",
  "official_url",
  "topic_tags",
  "provenance",
  "retrieval_date",
  "verification_date",
  "jurisdiction_state",
].join(",");

const SNAPSHOT_COLUMNS = "id,label,entries,content_hash,captured_at";

function ownerIdOf(authenticated) {
  return authenticated.effectiveOwnerId || authenticated.user.id;
}

// Mirrors the HP-L2 references route mapping: snake_case row -> the camelCase
// factual-metadata record the domain layer validates.
function toRecord(row) {
  return {
    title: row.title,
    sectionIdentifier: row.section_identifier,
    issuingAuthority: row.issuing_authority,
    jurisdiction: row.jurisdiction,
    edition: row.edition,
    effectiveDate: row.effective_date,
    officialUrl: row.official_url,
    topicTags: row.topic_tags || [],
    provenance: row.provenance,
    retrievalDate: row.retrieval_date,
    verificationDate: row.verification_date,
    jurisdictionState: row.jurisdiction_state,
  };
}

function toSnapshot(row) {
  const entries = Array.isArray(row.entries) ? row.entries : [];
  return {
    id: row.id,
    label: row.label,
    entries,
    sourceCount: entries.length,
    contentHash: row.content_hash,
    capturedAt: row.captured_at,
  };
}

// GET /api/forge/designer/house-plans/snapshots — list the caller's
// regulatory snapshots (newest first). Read-only.
export async function GET() {
  try {
    if (!isHousePlansEnabled()) {
      return NextResponse.json(
        { error: "House Plans is not enabled." },
        { status: 404 }
      );
    }
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const { data, error } = await authenticated.supabaseClient
      .from("house_plans_regulatory_snapshots")
      .select(SNAPSHOT_COLUMNS)
      .eq("owner_id", ownerIdOf(authenticated))
      .order("captured_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({
      success: true,
      snapshots: (data || []).map(toSnapshot),
    });
  } catch (error) {
    console.error("House Plans snapshots list error", error);
    return NextResponse.json(
      { error: "Unable to load the regulatory snapshots." },
      { status: 500 }
    );
  }
}

// POST /api/forge/designer/house-plans/snapshots — capture a new snapshot of
// the caller's current reference library. Optional JSON body: { label }.
// Creation-only: there is no update or delete for snapshots.
export async function POST(req) {
  try {
    if (!isHousePlansEnabled()) {
      return NextResponse.json(
        { error: "House Plans is not enabled." },
        { status: 404 }
      );
    }
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const ownerId = ownerIdOf(authenticated);

    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { data: rows, error: readError } = await authenticated.supabaseClient
      .from("house_plans_regulatory_sources")
      .select(REFERENCE_COLUMNS)
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (readError) throw readError;
    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: "The reference library is empty — nothing to snapshot." },
        { status: 400 }
      );
    }

    const built = createRegulatorySnapshot({
      sources: rows.map(toRecord),
      label: body.label,
    });
    if (!built.ok) {
      return NextResponse.json(
        { error: "Invalid snapshot request.", details: built.errors },
        { status: 400 }
      );
    }

    const { data: latest, error: latestError } = await authenticated.supabaseClient
      .from("house_plans_regulatory_snapshots")
      .select(SNAPSHOT_COLUMNS)
      .eq("owner_id", ownerId)
      .order("captured_at", { ascending: false })
      .limit(1);
    if (latestError) throw latestError;
    if (
      latest &&
      latest.length > 0 &&
      latest[0].content_hash === built.snapshot.contentHash
    ) {
      return NextResponse.json({
        success: true,
        created: false,
        snapshot: toSnapshot(latest[0]),
      });
    }

    const insertBuilder = authenticated.supabaseClient
      .from("house_plans_regulatory_snapshots")
      .insert({
        owner_id: ownerId,
        label: built.snapshot.label,
        entries: built.snapshot.entries,
        content_hash: built.snapshot.contentHash,
        captured_at: built.snapshot.capturedAt,
      });
    const { data: inserted, error: insertError } = await insertBuilder.select(
      SNAPSHOT_COLUMNS
    );
    if (insertError) throw insertError;
    return NextResponse.json(
      {
        success: true,
        created: true,
        snapshot: toSnapshot((inserted || [])[0] || {}),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("House Plans snapshot capture error", error);
    return NextResponse.json(
      { error: "Unable to save the regulatory snapshot." },
      { status: 500 }
    );
  }
}
