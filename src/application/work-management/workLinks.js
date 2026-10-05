// FORGE Work Management — Typed Object Links application service (Rung 2).
//
// db-injected orchestration over forge_work_links and
// forge_work_link_confirmations. All functions take a supabase-shaped `db`
// (`.from(table)` chains) so they unit-test with mocks. The authenticated API
// routes resolve owner_id via resolveEffectiveOwnerId (workspace model) and
// pass the acting user as actor — attribution is never isolation.
//
// A link is only created when BOTH endpoints resolve to real records inside
// the link's own workspace. A link whose endpoints live in different
// workspaces can never be created or reach active: the resolution queries are
// scoped to the link owner_id, so a foreign record simply does not resolve
// and the write is rejected with the endpoint named — never silent.
//
// Migrations for these tables ship in the PR but are NOT applied to
// production here; they need Jason's separate word like every migration.

import {
  LINK_PROVENANCE, LINK_STATUS,
  validateLinkInput, validateStatusTransition, validateConfirm,
  isResolvableRelationshipType,
} from "@/domains/work-management/workLinks.js";

const TABLES = Object.freeze({
  links: "forge_work_links",
  confirmations: "forge_work_link_confirmations",
});

// Verified endpoint domains -> authoritative tables
// (docs/forge-work-management/existing-domain-inventory.md). Endpoint types
// whose domains have no authoritative table yet (workmgmt.project,
// property.investor_property, people.*) are vocabulary-valid but rejected at
// write time with an explicit "not yet supported" — never silently.
const ENDPOINT_TABLES = Object.freeze({
  "workmgmt:work_package": "forge_work_packages",
  "workmgmt:forge_work_asset": "forge_work_assets",
  "workmgmt:forge_work_location": "forge_work_locations",
  "workmgmt:forge_work_document": "forge_work_document_library",
  "scheduling:schedule_block": "schedule_blocks",
  "designer:designer_project": "designer_projects",
  "documents:rental_document": "rental_documents",
  "financial:financial_event": "financial_events",
  "capture:capture_artifact": "capture_library",
  "rental:rental_maintenance_work_order": "rental_maintenance_work_orders",
  "rental:rental_contractor": "rental_contractors",
  "rental:rental_vendor": "rental_vendors",
});

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function endpointKey(domain, type) {
  return `${domain}:${type}`;
}

// Resolve one endpoint to a real record inside the link's workspace.
// Returns { ok: true } or { ok: false, reason }.
// reason 'missing': no such record (or it is soft-deleted) — the link is broken.
// reason 'superseded': the record exists but is a superseded document version —
//   the other end changed, so an existing link goes stale (never silently ok).
async function resolveEndpoint(db, ownerId, domain, type, id) {
  const table = ENDPOINT_TABLES[endpointKey(domain, type)];
  if (!table) return { ok: false, reason: "unsupported" };
  const { data, error } = await db.from(table).select("id, is_current_version, deleted_at")
    .eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data || data.deleted_at) return { ok: false, reason: "missing" };
  if (data.is_current_version === false) return { ok: false, reason: "superseded" };
  return { ok: true };
}

async function getLink(db, ownerId, linkId) {
  const { data, error } = await db.from(TABLES.links).select("*")
    .eq("owner_id", ownerId).eq("id", linkId).maybeSingle();
  if (error) throw error;
  return data || null;
}

function unsupportedMessage(domain, type) {
  return `Link endpoints of type ${domain}.${type} are not supported yet — ` +
    `their domain has no verified authoritative table. ` +
    `Supported: ${Object.keys(ENDPOINT_TABLES).join(", ")}.`;
}

// Create a link. Both endpoints must resolve inside the workspace or the
// write is rejected naming the endpoint. New links are inserted as
// unresolved and promoted by their first resolution in the same call — an
// unchecked link never defaults to active.
export async function createLink(db, { ownerId, actor, input }) {
  // Validate what will actually be stored: created_by is ALWAYS the actor.
  // Validating a caller-supplied created_by first would let a human pass
  // created_by 'brain-proposal' + provenance 'ai_proposed' and inject a
  // fake brain proposal they can then confirm themselves.
  const validation = validateLinkInput({ ...input, created_by: actor });
  if (!validation.ok) {
    return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  }
  if (!isResolvableRelationshipType(input.relationship_type)) {
    return { ok: false, httpStatus: 400,
      error: `relationship_type '${input.relationship_type}' is defined but its endpoints ` +
        `have no verified authoritative table yet; not supported in Rung 2.` };
  }
  // created_by is ALWAYS the acting user — never a caller-supplied value.
  // A forged created_by ('brain-proposal', the owner's id, ...) would
  // misattribute the link's provenance. The Brain files proposals as its own
  // actor; humans file as themselves.
  const createdBy = actor;
  const provenance = input.provenance ?? LINK_PROVENANCE.USER_CONFIRMED;
  for (const end of ["source", "target"]) {
    const domain = input[`${end}_domain`];
    const type = input[`${end}_type`];
    const id = input[`${end}_id`];
    const resolved = await resolveEndpoint(db, ownerId, domain, type, id);
    if (!resolved.ok && resolved.reason === "unsupported") {
      return { ok: false, httpStatus: 400, error: unsupportedMessage(domain, type) };
    }
    if (!resolved.ok) {
      const why = resolved.reason === "superseded"
        ? `is a superseded version — link the current version instead.`
        : `not found in this workspace. Cross-workspace links are rejected.`;
      return { ok: false, httpStatus: 400,
        error: `Link ${end} does not resolve: ${domain}.${type} '${id}' ${why}` };
    }
  }
  const now = new Date().toISOString();
  const row = {
    owner_id: ownerId,
    id: newId("forge_wlink"),
    source_domain: input.source_domain,
    source_type: input.source_type,
    source_id: input.source_id,
    source_locator: input.source_locator ?? null,
    source_version: input.source_version ?? null,
    target_domain: input.target_domain,
    target_type: input.target_type,
    target_id: input.target_id,
    relationship_type: input.relationship_type,
    created_by: createdBy,
    created_at: now,
    observed_at: now,
    provenance,
    confirmed_by: provenance === LINK_PROVENANCE.USER_CONFIRMED ? createdBy : null,
    confirmed_at: provenance === LINK_PROVENANCE.USER_CONFIRMED ? now : null,
    status: LINK_STATUS.UNRESOLVED,
    resolved_at: null,
    resolved_state: null,
    annotation: input.annotation ?? null,
    notes: input.notes ?? null,
  };
  const { data: inserted, error: insertError } = await db.from(TABLES.links)
    .insert(row).select("*").single();
  if (insertError) {
    if (insertError.code === "23505") {
      return { ok: false, httpStatus: 409, error: "This exact link already exists." };
    }
    throw insertError;
  }
  // First resolution promotes unresolved -> active (both endpoints were just
  // verified above, so this is the recorded resolution, not an assumption).
  const { data: resolved, error: resolveError } = await db.from(TABLES.links)
    .update({ status: LINK_STATUS.ACTIVE, resolved_at: now, resolved_state: "ok" })
    .eq("owner_id", ownerId).eq("id", inserted.id).select("*").single();
  if (resolveError) throw resolveError;
  return { ok: true, link: resolved };
}

// List links in the workspace. packageId narrows to links touching one
// package on either end. No join assumes resolvability — readers get status.
export async function listLinks(db, { ownerId, packageId, status, relationshipType, provenance }) {
  async function queryFor(end) {
    let q = db.from(TABLES.links).select("*").eq("owner_id", ownerId);
    if (packageId) {
      q = q.eq(`${end}_domain`, "workmgmt").eq(`${end}_type`, "work_package").eq(`${end}_id`, packageId);
    }
    if (status) q = q.eq("status", status);
    if (relationshipType) q = q.eq("relationship_type", relationshipType);
    if (provenance) q = q.eq("provenance", provenance);
    q = q.order("created_at", { ascending: false });
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  let links;
  if (packageId) {
    const [asSource, asTarget] = await Promise.all([queryFor("source"), queryFor("target")]);
    const seen = new Map();
    for (const link of [...asSource, ...asTarget]) seen.set(link.id, link);
    links = [...seen.values()].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  } else {
    links = await queryFor("source");
  }
  return { ok: true, links };
}

// Link detail: the link plus its full immutable confirmation history.
export async function getLinkDetail(db, { ownerId, linkId }) {
  const link = await getLink(db, ownerId, linkId);
  if (!link) return { ok: false, httpStatus: 404, error: "Link not found." };
  const { data, error } = await db.from(TABLES.confirmations).select("*")
    .eq("owner_id", ownerId).eq("link_id", linkId).order("confirmed_at", { ascending: false });
  if (error) throw error;
  return { ok: true, link, confirmations: data || [] };
}

// Confirm an AI-proposed link. Writes the immutable confirmation record
// first, then flips provenance — the enum flip never stands alone.
export async function confirmLink(db, { ownerId, actor, linkId, note }) {
  const link = await getLink(db, ownerId, linkId);
  if (!link) return { ok: false, httpStatus: 404, error: "Link not found." };
  const check = validateConfirm(link, actor);
  if (!check.ok) return { ok: false, httpStatus: 409, error: check.error };
  const now = new Date().toISOString();
  const { data: confirmation, error: cError } = await db.from(TABLES.confirmations).insert({
    owner_id: ownerId, id: newId("forge_wlconf"), link_id: linkId,
    confirmed_by: actor, confirmed_at: now,
    prior_provenance: link.provenance, note: note || null,
  }).select("*").single();
  if (cError) throw cError;
  const { data: updated, error: uError } = await db.from(TABLES.links)
    .update({ provenance: LINK_PROVENANCE.USER_CONFIRMED, confirmed_by: actor, confirmed_at: now })
    .eq("owner_id", ownerId).eq("id", linkId).select("*").single();
  if (uError) throw uError;
  return { ok: true, link: updated, confirmation };
}

// Re-resolve a link's endpoints. Success returns it to active; a missing
// endpoint marks it broken — surfaced, never silently dropped. An endpoint
// that resolves to a superseded document version marks the link stale:
// the other end changed, and a person should re-point it.
export async function recheckLink(db, { ownerId, linkId }) {
  const link = await getLink(db, ownerId, linkId);
  if (!link) return { ok: false, httpStatus: 404, error: "Link not found." };
  const [source, target] = await Promise.all([
    resolveEndpoint(db, ownerId, link.source_domain, link.source_type, link.source_id),
    resolveEndpoint(db, ownerId, link.target_domain, link.target_type, link.target_id),
  ]);
  const now = new Date().toISOString();
  const superseded = [source, target].some((r) => !r.ok && r.reason === "superseded");
  const nextStatus = superseded ? LINK_STATUS.STALE
    : (source.ok && target.ok ? LINK_STATUS.ACTIVE : LINK_STATUS.BROKEN);
  const transition = validateStatusTransition(link.status, nextStatus);
  if (!transition.ok) {
    return { ok: false, httpStatus: 409, error: transition.error };
  }
  const { data: updated, error } = await db.from(TABLES.links).update({
    status: nextStatus,
    resolved_at: now,
    resolved_state: nextStatus === LINK_STATUS.STALE ? "moved"
      : (source.ok && target.ok ? "ok" : "unavailable"),
  }).eq("owner_id", ownerId).eq("id", linkId).select("*").single();
  if (error) throw error;
  return { ok: true, link: updated };
}

// Flag a link stale: the target moved or its referenced revision is no
// longer current (detected by resolver checks). The link stays; the reason
// is recorded so the UI can say what changed.
export async function flagLinkStale(db, { ownerId, linkId, reason }) {
  const link = await getLink(db, ownerId, linkId);
  if (!link) return { ok: false, httpStatus: 404, error: "Link not found." };
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { ok: false, httpStatus: 400, error: "A stale reason is required." };
  }
  const transition = validateStatusTransition(link.status, LINK_STATUS.STALE);
  if (!transition.ok) return { ok: false, httpStatus: 409, error: transition.error };
  const now = new Date().toISOString();
  const staleNote = `[${now}] stale: ${reason.trim()}`;
  const { data: updated, error } = await db.from(TABLES.links).update({
    status: LINK_STATUS.STALE, resolved_at: now, resolved_state: "moved",
    notes: link.notes ? `${link.notes}\n${staleNote}` : staleNote,
  }).eq("owner_id", ownerId).eq("id", linkId).select("*").single();
  if (error) throw error;
  return { ok: true, link: updated };
}

// Unlink: delete the link row. Confirmation history is append-only and
// survives (it references the link id), so the audit trail is never lost.
export async function unlinkWorkLink(db, { ownerId, linkId }) {
  const link = await getLink(db, ownerId, linkId);
  if (!link) return { ok: false, httpStatus: 404, error: "Link not found." };
  const { error } = await db.from(TABLES.links)
    .delete().eq("owner_id", ownerId).eq("id", linkId);
  if (error) throw error;
  return { ok: true, unlinked: linkId };
}
