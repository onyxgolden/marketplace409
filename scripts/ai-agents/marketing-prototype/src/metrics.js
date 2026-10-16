/**
 * metrics.js — marketing domain logic: classification, event validation,
 * conversion dedup, attribution, funnel metrics, pooling and header-claim
 * comparison. Exact integer/rational arithmetic only (see rational.js);
 * zero denominators yield typed UNDEFINED, never 0/NaN/Infinity.
 */

import { canonicalJson } from "./canonical.js";
import { rat, ratEq, parseDecimal, formatPercent, formatRoas, exactString } from "./rational.js";
import { parseTimestamp, CONVERSION_KINDS, MONEY_KINDS } from "./schemas.js";
import { scanRow } from "./injection.js";
import { makeCitation, unavailableCitation } from "./citations.js";

export const UNKNOWN_TAG = "UNKNOWN_TAG";

/** Rate value constructors. */
const definedRate = (r, display) => ({ status: "DEFINED", numerator: r.n.toString(), denominator: r.d.toString(), display });
const undefinedRate = () => ({ status: "UNDEFINED", display: "UNDEFINED" });
const unavailableRate = () => ({ status: "UNAVAILABLE", display: "UNAVAILABLE" });
const unverifiableRate = () => ({ status: "UNVERIFIABLE", display: "UNVERIFIABLE" });

/**
 * Classify campaigns from the EXACT structured objective tag. Unknown
 * tags become UNKNOWN_TAG (never forced); no semantics are inferred
 * from copy. 2 spans per campaign: identity + classification evidence.
 * Each classification carries a verified citation to the exact source
 * row bytes.
 */
export function classifyCampaigns(wrappedRows, tags, sx) {
  const seen = new Set();
  for (const w of wrappedRows) {
    const row = w.row;
    sx.budget.chargeSpan(2);
    const hits = scanRow("campaigns", row);
    if (hits.length > 0) {
      const h = hits[0];
      sx.quarantine(w.fixture_id, row.campaign_id, h.family, `campaigns.${h.field} matched injection family ${h.family}; notes dropped, campaign still analyzed`, w.source_ref);
      sx.diag("INSTRUCTION_INJECTION", "warning", w.source_ref, row.campaign_id, `quarantined campaigns.${h.field} (${h.family})`);
    }
    if (seen.has(row.campaign_id)) {
      throw sx.invalid(`duplicate campaign_id ${JSON.stringify(row.campaign_id)}`, w.source_ref, row.campaign_id);
    }
    seen.add(row.campaign_id);
    const tag = row.objective.tag;
    const tagMeta = tags.get(tag);
    const classification = tagMeta ? tag : UNKNOWN_TAG;
    if (classification === UNKNOWN_TAG) {
      sx.diag("UNKNOWN_OBJECTIVE_TAG", "info", w.source_ref, row.campaign_id, `objective tag ${JSON.stringify(tag)} not in taxonomy v1; classified UNKNOWN_TAG`);
    }
    // Verified citation to the exact source row bytes.
    const bytes = sx.fixtureBytes.get(w.fixture_id);
    let citation;
    if (bytes && w.byte_span) {
      sx.budget.chargeSpan(1); // citation evidence span
      citation = makeCitation(bytes, w.byte_span[0], w.byte_span[1], w.source_ref);
    } else {
      citation = unavailableCitation("source row bytes not retained", w.source_ref);
    }
    // M640-002: cite the taxonomy rule (tag registry entry) that
    // established the classification, not just the campaign row.
    let ruleCitation = null;
    if (tagMeta && tagMeta.byte_span) {
      const taxBytes = sx.fixtureBytes.get(tagMeta.fixture_id);
      if (taxBytes) {
        try {
          sx.budget.chargeSpan(1);
          ruleCitation = makeCitation(taxBytes, tagMeta.byte_span[0], tagMeta.byte_span[1], tagMeta.source_ref);
          sx.markUsed(tagMeta.fixture_id);
        } catch {
          ruleCitation = unavailableCitation("taxonomy tag row bytes not verifiable", tagMeta.source_ref);
        }
      } else {
        ruleCitation = unavailableCitation("taxonomy tag row bytes not retained", tagMeta.source_ref);
      }
    } else if (classification !== UNKNOWN_TAG) {
      ruleCitation = unavailableCitation("taxonomy tag registry entry not found", w.source_ref);
    }
    const citations = [citation];
    if (ruleCitation) citations.push(ruleCitation);
    sx.markUsed(w.fixture_id);
    sx.campaigns.set(row.campaign_id, {
      row,
      classification,
      currency: row.currency,
      quarantinedNotes: hits.length > 0,
      fixture_id: w.fixture_id,
      source_ref: w.source_ref,
      citation,
      ruleCitation,
      citations,
    });
  }
}

/**
 * Validate event rows: identity (duplicate ids), timestamp, window,
 * kind, campaign registration. Returns the valid in-window events.
 * Throws a REFUSED-signal on conflicting duplicate event ids.
 */
export function processEventRows(wrappedRows, sx) {
  const byId = new Map(); // event_id -> canonical payload
  const valid = [];
  for (const w of wrappedRows) {
    const row = w.row;
    // 4 spans per event row: identity, timestamp, window, campaign binding.
    sx.budget.chargeSpan(4);
    sx.markUsed(w.fixture_id); // event row consulted (valid, excluded, or duplicate)
    const prev = byId.get(row.event_id);
    const canon = canonicalJson(row);
    if (prev !== undefined) {
      if (prev === canon) {
        sx.diag("DUPLICATE_EVENT_IGNORED", "info", w.source_ref, row.event_id, "identical event_id repeated; counted once");
        sx.exclude("DUPLICATE_EVENT", 1, { [row.kind]: 1 }, row.campaign_id);
        continue;
      }
      throw sx.refused(
        "DUPLICATE_EVENT_CONFLICT",
        `duplicate event_id ${JSON.stringify(row.event_id)} with conflicting payloads`,
        { sourceRef: w.source_ref, recordId: row.event_id }
      );
    }
    byId.set(row.event_id, canon);
    const ts = parseTimestamp(row.timestamp);
    const inWindow = ts !== null && ts >= sx.periodStart && ts < sx.periodEnd;
    if (!inWindow) {
      sx.exclude("OUT_OF_WINDOW", 1, { [row.kind]: 1 }, row.campaign_id);
      sx.diag("EVENT_OUT_OF_WINDOW", "info", w.source_ref, row.event_id, "event outside reporting period; excluded with count");
      continue;
    }
    if (!sx.campaigns.has(row.campaign_id)) {
      sx.exclude("UNREGISTERED_CAMPAIGN", 1, { [row.kind]: 1 }, row.campaign_id);
      sx.diag("EVENT_UNREGISTERED_CAMPAIGN", "warning", w.source_ref, row.event_id, `campaign ${JSON.stringify(row.campaign_id)} not registered; event excluded`);
      continue;
    }
    valid.push({ ...row, _fixture_id: w.fixture_id, _source_ref: w.source_ref, _byte_span: w.byte_span });
  }
  return valid;
}

/**
 * Conversion dedup: one conversion_id counted once per campaign/period.
 * The grouping key is (campaign_id, reporting period, conversion_id):
 * the same conversion_id in two different campaigns (or periods) is two
 * independent conversions, never a cross-campaign conflict. Different
 * event ids with the same conversion_id and identical payloads count
 * once; conflicting payloads (or ambiguous binding) are excluded.
 * 1 span per duplicate group.
 */
export function dedupeConversions(validEvents, sx) {
  const withCid = validEvents.filter((e) => CONVERSION_KINDS.has(e.kind) && e.conversion_id);
  const periodKey = `${sx.periodIsoStart}\0${sx.periodIsoEnd}`;
  const groups = new Map();
  for (const e of withCid) {
    const gkey = `${e.campaign_id}\0${periodKey}\0${e.conversion_id}`;
    if (!groups.has(gkey)) groups.set(gkey, []);
    groups.get(gkey).push(e);
  }
  const excludedEventIds = new Set();
  const countedOnceIds = new Set();
  for (const [gkey, evts] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (evts.length === 1) continue;
    sx.budget.chargeSpan(1);
    const cid = evts[0].conversion_id;
    const campaignId = evts[0].campaign_id;
    // Verified citations to each duplicate event row.
    // M640-002: invalid/missing citations force explicit unavailable
    // status — never silently skipped.
    const citations = [];
    for (const e of evts) {
      if (e._byte_span && e._fixture_id) {
        const bytes = sx.fixtureBytes?.get(e._fixture_id);
        if (bytes) {
          sx.budget.chargeSpan(1);
          try {
            citations.push(makeCitation(bytes, e._byte_span[0], e._byte_span[1], e._source_ref));
            sx.markUsed(e._fixture_id);
          } catch {
            citations.push(unavailableCitation("duplicate event row bytes not verifiable", e._source_ref));
          }
        } else {
          citations.push(unavailableCitation("duplicate event row bytes not retained", e._source_ref));
        }
      } else {
        citations.push(unavailableCitation("duplicate event row byte span missing", e._source_ref ?? null));
      }
    }
    const payloads = evts.map((e) =>
      canonicalJson({
        kind: e.kind,
        amount_minor: e.amount_minor ?? null,
        timestamp: e.timestamp,
        campaign_id: e.campaign_id,
        attribution_campaign_id: e.attribution_campaign_id ?? null,
      })
    );
    const ids = evts.map((e) => e.event_id).sort();
    const allIdentical = payloads.every((p) => p === payloads[0]);
    if (allIdentical) {
      countedOnceIds.add(ids[0]);
      for (const id of ids.slice(1)) excludedEventIds.add(id);
      sx.duplicateGroups.push({ conversion_id: cid, campaign_id: campaignId, period: { start: sx.periodIsoStart, end: sx.periodIsoEnd }, event_ids: ids, resolution: "COUNTED_ONCE", counted: 1, citations });
      sx.diag("DUPLICATE_CONVERSION_COUNTED_ONCE", "info", evts[0]._source_ref, cid, `${ids.length} events share conversion_id with identical payloads; counted once`);
    } else {
      for (const id of ids) excludedEventIds.add(id);
      sx.duplicateGroups.push({ conversion_id: cid, campaign_id: campaignId, period: { start: sx.periodIsoStart, end: sx.periodIsoEnd }, event_ids: ids, resolution: "CONFLICT_EXCLUDED", counted: 0, citations });
      sx.diag("DUPLICATE_CONVERSION_CONFLICT", "warning", evts[0]._source_ref, cid, "same conversion_id with conflicting payloads; excluded, counted zero");
    }
  }
  return validEvents.filter((e) => !excludedEventIds.has(e.event_id));
}

/**
 * Attribution: exact registered campaign binding, never inferred.
 * A CONVERSION/REVENUE event is attributed iff exactly one bindings row
 * maps its event_id to its own campaign_id, and any stated
 * attribution_campaign_id agrees. 2 extra spans per conversion/revenue
 * event: attribution + conversion-identity. Missing/ambiguous
 * attribution makes the campaign's conversion/revenue metrics
 * UNAVAILABLE (never silently dropped).
 */
export function applyAttribution(events, sx) {
  const unattributedByCampaign = new Map();
  // M640-002: retain the binding row metadata for each attributed event,
  // so metrics can cite the exact binding that established attribution.
  if (!sx.attributionBindings) sx.attributionBindings = new Map(); // event_id -> {byte_span, fixture_id, source_ref}
  for (const e of events) {
    if (!CONVERSION_KINDS.has(e.kind)) continue;
    // 2 spans: attribution binding check + conversion identity check.
    sx.budget.chargeSpan(2);
    const bound = sx.bindings.get(e.event_id) ?? [];
    const ok =
      bound.length === 1 &&
      bound[0].campaign_id === e.campaign_id &&
      (e.attribution_campaign_id == null || e.attribution_campaign_id === e.campaign_id);
    if (!ok) {
      if (!unattributedByCampaign.has(e.campaign_id)) unattributedByCampaign.set(e.campaign_id, []);
      unattributedByCampaign.get(e.campaign_id).push(e.event_id);
      sx.diag(
        "ATTRIBUTION_UNAVAILABLE",
        "warning",
        e._source_ref,
        e.event_id,
        `no exact registered binding for event (bindings found: ${bound.length}); conversion/revenue metrics unavailable`
      );
    } else {
      sx.attributionBindings.set(e.event_id, bound[0]);
    }
  }
  return unattributedByCampaign;
}

function baseMetricRow(campaignId, currency, mode, sx) {
  return {
    campaign_id: campaignId,
    period: { start: sx.periodIsoStart, end: sx.periodIsoEnd },
    currency,
    mode,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    spend_minor: "0",
    revenue_minor: "0",
    ctr: undefinedRate(),
    conversion_rate: undefinedRate(),
    roas: undefinedRate(),
    integrity_flags: [],
    status: "READY",
    population_complete: sx.completeness.get(campaignId) === true,
  };
}

function finalizeRates(m, sx) {
  m.ctr = m.impressions === 0 ? undefinedRate() : definedRate(rat(m.clicks, m.impressions), formatPercent(rat(m.clicks, m.impressions)));
  if (m.status === "READY") {
    m.conversion_rate =
      m.clicks === 0 ? undefinedRate() : definedRate(rat(m.conversions, m.clicks), formatPercent(rat(m.conversions, m.clicks)));
    m.roas =
      m.spendMinor === 0n ? undefinedRate() : definedRate(rat(m.revenueMinor, m.spendMinor), formatRoas(rat(m.revenueMinor, m.spendMinor)));
  }
  // integrity flags under the deliberately simple funnel model.
  // An impossible funnel is not a READY funnel: it blocks completeness.
  if (m.clicks > m.impressions) m.integrity_flags.push("CLICKS_EXCEED_IMPRESSIONS");
  if (m.conversions > m.clicks) m.integrity_flags.push("CONVERSIONS_EXCEED_CLICKS");
  if (m.integrity_flags.length > 0) {
    sx.budget.chargeSpan(1);
    sx.diag("INTEGRITY_FLAG", "error", null, m.campaign_id, `funnel integrity failure: ${m.integrity_flags.join(",")}; metric not READY, report cannot be complete`);
    m.status = "UNVERIFIABLE";
    m.ctr = unverifiableRate();
    m.conversion_rate = unverifiableRate();
    m.roas = unverifiableRate();
  }
  m.spend_minor = m.spendMinor.toString();
  m.revenue_minor = m.revenueMinor.toString();
  delete m.spendMinor;
  delete m.revenueMinor;
  return m;
}

/** Event-mode metrics, grouped by campaign (+period+currency). Each metric
 *  carries verified citations to its material input rows. */
export function computeEventMetrics(events, unattributedByCampaign, sx) {
  const acc = new Map();
  const citationsByCampaign = new Map(); // campaign_id -> Citation[]
  for (const c of sx.campaigns.values()) {
    const m = baseMetricRow(c.row.campaign_id, c.currency, "event_rows", sx);
    m.spendMinor = 0n;
    m.revenueMinor = 0n;
    acc.set(c.row.campaign_id, m);
    citationsByCampaign.set(c.row.campaign_id, []);
    // Cite the campaign registration as a material input.
    if (c.citation) citationsByCampaign.get(c.row.campaign_id).push(c.citation);
  }
  for (const e of events) {
    const m = acc.get(e.campaign_id);
    if (!m) continue;
    // Cite each material event row. M640-002: never silently skip.
    if (e._byte_span && e._fixture_id) {
      const bytes = sx.fixtureBytes?.get(e._fixture_id);
      if (bytes) {
        sx.budget.chargeSpan(1);
        try {
          citationsByCampaign.get(e.campaign_id).push(
            makeCitation(bytes, e._byte_span[0], e._byte_span[1], e._source_ref)
          );
          sx.markUsed(e._fixture_id);
        } catch {
          citationsByCampaign.get(e.campaign_id).push(
            unavailableCitation("event row bytes not verifiable", e._source_ref)
          );
        }
      } else {
        citationsByCampaign.get(e.campaign_id).push(
          unavailableCitation("event row bytes not retained", e._source_ref)
        );
      }
    } else {
      citationsByCampaign.get(e.campaign_id).push(
        unavailableCitation("event row byte span missing", e._source_ref ?? null)
      );
    }
    if (e.kind === "IMPRESSION") m.impressions += 1;
    else if (e.kind === "CLICK") m.clicks += 1;
    else if (e.kind === "SPEND") m.spendMinor += BigInt(e.amount_minor);
    else if (e.kind === "CONVERSION") {
      if (!(unattributedByCampaign.get(e.campaign_id) ?? []).includes(e.event_id)) m.conversions += 1;
    } else if (e.kind === "REVENUE") {
      if (!(unattributedByCampaign.get(e.campaign_id) ?? []).includes(e.event_id)) {
        m.revenueMinor += BigInt(e.amount_minor);
      }
    }
  }
  for (const [cid, m] of acc) {
    if ((unattributedByCampaign.get(cid) ?? []).length > 0) {
      m.status = "UNAVAILABLE";
      m.conversions = null;
      m.conversion_rate = unavailableRate();
      m.roas = unavailableRate();
      sx.diag("METRICS_UNAVAILABLE", "warning", null, cid, "conversion/revenue metrics unavailable: missing or ambiguous attribution");
    }
    const fin = finalizeRates(m, sx);
    if (m.status === "UNAVAILABLE") fin.revenue_minor = null; // unattributed revenue is not a usable total
    const mc = citationsByCampaign.get(cid);
    // M640-002: cite the binding rows that established attribution for
    // this campaign's conversions, and the completeness declaration.
    if (sx.attributionBindings) {
      const seenB = new Set();
      for (const e of events) {
        if (e.campaign_id !== cid) continue;
        const b = sx.attributionBindings.get(e.event_id);
        if (b && b.byte_span && !seenB.has(b.fixture_id + ":" + b.byte_span[0])) {
          seenB.add(b.fixture_id + ":" + b.byte_span[0]);
          const bb = sx.fixtureBytes.get(b.fixture_id);
          if (bb) {
            try {
              sx.budget.chargeSpan(1);
              mc.push(makeCitation(bb, b.byte_span[0], b.byte_span[1], b.source_ref));
              sx.markUsed(b.fixture_id);
            } catch {
              mc.push(unavailableCitation("binding row bytes not verifiable", b.source_ref));
            }
          }
        }
      }
    }
    // Completeness declaration citation.
    const compMeta = sx._completenessRowMeta?.get(cid);
    if (compMeta && compMeta.byte_span) {
      const cb = sx.fixtureBytes.get(compMeta.fixture_id);
      if (cb) {
        try {
          sx.budget.chargeSpan(1);
          mc.push(makeCitation(cb, compMeta.byte_span[0], compMeta.byte_span[1], compMeta.source_ref));
        } catch {
          mc.push(unavailableCitation("completeness row bytes not verifiable", compMeta.source_ref));
        }
      }
    }
    fin.citations = mc;
    sx.metrics.set(cid, fin);
  }
}

/** Aggregate-count mode: claimed primary counts, arithmetic verification via header claims.
 *  Each metric carries a verified citation to its aggregate row bytes. */
export function computeAggregateMetrics(wrappedRows, sx) {
  const seen = new Set();
  for (const w of wrappedRows) {
    const row = w.row;
    sx.budget.chargeSpan(3); // identity, grain, arithmetic-verification
    const hits = scanRow("aggregate_counts", row);
    if (hits.length > 0) {
      const h = hits[0];
      sx.quarantine(w.fixture_id, row.campaign_id, h.family, `aggregate_counts.notes matched injection family ${h.family}; notes dropped`, w.source_ref);
      sx.diag("INSTRUCTION_INJECTION", "warning", w.source_ref, row.campaign_id, `quarantined aggregate_counts.notes (${h.family})`);
    }
    if (seen.has(row.campaign_id)) {
      throw sx.invalid(`duplicate aggregate_counts row for campaign ${JSON.stringify(row.campaign_id)}`, w.source_ref, row.campaign_id);
    }
    seen.add(row.campaign_id);
    if (!sx.campaigns.has(row.campaign_id)) {
      sx.exclude("UNREGISTERED_CAMPAIGN", 1, {}, row.campaign_id);
      sx.diag("AGGREGATE_UNREGISTERED_CAMPAIGN", "warning", w.source_ref, row.campaign_id, "aggregate row for unregistered campaign; excluded");
      continue;
    }
    const camp = sx.campaigns.get(row.campaign_id);
    if (row.period_start !== sx.periodIsoStart || row.period_end !== sx.periodIsoEnd) {
      sx.exclude("PERIOD_MISMATCH", 1, {}, row.campaign_id);
      sx.diag("AGGREGATE_PERIOD_MISMATCH", "warning", w.source_ref, row.campaign_id, "aggregate row period differs from task period; excluded");
      continue;
    }
    if (row.currency !== camp.currency) {
      sx.exclude("CURRENCY_MISMATCH", 1, {}, row.campaign_id);
      sx.diag("AGGREGATE_CURRENCY_MISMATCH", "warning", w.source_ref, row.campaign_id, "aggregate row currency differs from campaign currency; excluded");
      continue;
    }
    // Verified citation to the exact aggregate row bytes.
    const bytes = sx.fixtureBytes.get(w.fixture_id);
    let citation;
    if (bytes && w.byte_span) {
      sx.budget.chargeSpan(1);
      citation = makeCitation(bytes, w.byte_span[0], w.byte_span[1], w.source_ref);
      sx.markUsed(w.fixture_id);
    } else {
      citation = unavailableCitation("source row bytes not retained", w.source_ref);
    }
    const declaredComplete = sx.completeness.get(row.campaign_id) === true;
    const m = baseMetricRow(row.campaign_id, row.currency, "aggregate_counts", sx);
    m.impressions = row.impressions;
    m.clicks = row.clicks;
    m.conversions = row.conversions;
    m.spendMinor = BigInt(row.spend_minor);
    m.revenueMinor = BigInt(row.revenue_minor);
    m.citations = [citation];
    if (camp.citation) m.citations.push(camp.citation);
    // M640-002: cite the completeness declaration behind the
    // population_complete decision.
    const compMeta = sx._completenessRowMeta?.get(row.campaign_id);
    if (compMeta && compMeta.byte_span) {
      const cb = sx.fixtureBytes.get(compMeta.fixture_id);
      if (cb) {
        try {
          sx.budget.chargeSpan(1);
          m.citations.push(makeCitation(cb, compMeta.byte_span[0], compMeta.byte_span[1], compMeta.source_ref));
        } catch {
          m.citations.push(unavailableCitation("completeness row bytes not verifiable", compMeta.source_ref));
        }
      }
    } else if (!declaredComplete) {
      // No declaration row: the "not complete" decision is explicit.
      m.citations.push(unavailableCitation("no completeness declaration row for campaign; population_complete=false", w.source_ref));
    }
    if (!declaredComplete) {
      // Empty/missing line items behind claimed totals => UNVERIFIABLE, complete:false.
      m.status = "UNVERIFIABLE";
      m.ctr = unverifiableRate();
      m.conversion_rate = unverifiableRate();
      m.roas = unverifiableRate();
      sx.diag("METRICS_UNVERIFIABLE", "warning", w.source_ref, row.campaign_id, "claimed totals without a complete-population declaration; metrics UNVERIFIABLE");
      m.spend_minor = m.spendMinor.toString();
      m.revenue_minor = m.revenueMinor.toString();
      delete m.spendMinor;
      delete m.revenueMinor;
    } else {
      finalizeRates(m, sx);
    }
    sx.metrics.set(row.campaign_id, m);
  }
  // Registered campaigns with no aggregate row: absent primary counts are
  // NOT evidence of zero. M640-004: absent counts are null (typed
  // unknown), NEVER numeric zero — a zero would let a header claim of
  // "0" MATCH against absent evidence. Without an explicit supported
  // evidenced zero row, the metric is UNVERIFIABLE and the report cannot
  // be complete.
  for (const c of sx.campaigns.values()) {
    if (!sx.metrics.has(c.row.campaign_id)) {
      const m = baseMetricRow(c.row.campaign_id, c.currency, "aggregate_counts", sx);
      m.impressions = null;
      m.clicks = null;
      m.conversions = null;
      m.spend_minor = null;
      m.revenue_minor = null;
      m.status = "UNVERIFIABLE";
      m.ctr = unverifiableRate();
      m.conversion_rate = unverifiableRate();
      m.roas = unverifiableRate();
      // Cite the campaign registration (the only evidence: the campaign
      // exists but has no aggregate row). The absent counts are explicitly
      // unavailable, not zero.
      m.citations = [];
      if (c.citation) m.citations.push(c.citation);
      m.citations.push(unavailableCitation("no aggregate_counts row for campaign; counts unavailable, not zero", null));
      sx.diag("METRICS_UNVERIFIABLE", "warning", null, c.row.campaign_id, "no aggregate row for registered campaign; absent counts are not evidence of zero; metrics UNVERIFIABLE");
      sx.metrics.set(c.row.campaign_id, m);
    }
  }
}

/**
 * Pooled rates for host-declared disjoint populations: denominators are
 * summed, never averaged. Cross-currency pooling and non-ready members
 * yield UNAVAILABLE, never a mixed-currency total and never FX.
 */
export function poolMetrics(poolGroups, sx) {
  const pooled = [];
  poolGroups.forEach((members, gi) => {
    const poolId = `pool-${gi}`;
    const rows = members.map((id) => ({ id, metric: sx.metrics.get(id), campaign: sx.campaigns.get(id) }));
    const missing = rows.filter((r) => !r.campaign);
    if (missing.length > 0) {
      sx.diag("POOL_UNKNOWN_MEMBER", "warning", null, poolId, `unknown campaign(s): ${missing.map((r) => r.id).join(",")}`);
      pooled.push({ pool_id: poolId, members: [...members].sort(), currency: null, status: "UNAVAILABLE", reason: "unknown member", ctr: unavailableRate(), roas: unavailableRate() });
      return;
    }
    const currencies = new Set(rows.map((r) => r.campaign.currency));
    if (currencies.size > 1) {
      sx.diag("POOL_CURRENCY_MISMATCH", "warning", null, poolId, "no cross-currency pooling and no FX in slice 1");
      pooled.push({ pool_id: poolId, members: [...members].sort(), currency: null, status: "UNAVAILABLE", reason: "currency mismatch", ctr: unavailableRate(), roas: unavailableRate() });
      return;
    }
    const notReady = rows.filter((r) => !r.metric || r.metric.status !== "READY");
    if (notReady.length > 0) {
      sx.diag("POOL_MEMBER_NOT_READY", "warning", null, poolId, `member(s) not READY: ${notReady.map((r) => r.id).join(",")}`);
      pooled.push({ pool_id: poolId, members: [...members].sort(), currency: rows[0].campaign.currency, status: "UNAVAILABLE", reason: "member not ready", ctr: unavailableRate(), roas: unavailableRate() });
      return;
    }
    let I = 0n, C = 0n, V = 0n, S = 0n, R = 0n;
    for (const r of rows) {
      I += BigInt(r.metric.impressions);
      C += BigInt(r.metric.clicks);
      V += BigInt(r.metric.conversions);
      S += BigInt(r.metric.spend_minor);
      R += BigInt(r.metric.revenue_minor);
    }
    const ctrR = I === 0n ? null : rat(C, I);
    const cvrR = C === 0n ? null : rat(V, C);
    const roasR = S === 0n ? null : rat(R, S);
    // M640-002: pooled outputs cite their member metrics' evidence.
    const poolCitations = [];
    for (const r of rows) {
      if (r.metric?.citations) {
        for (const c of r.metric.citations) {
          // Deduplicate by quoted_span to avoid repetition.
          if (!poolCitations.some((pc) => pc.quoted_span === c.quoted_span && pc.quoted_span !== null)) {
            poolCitations.push(c);
          }
        }
      }
    }
    pooled.push({
      pool_id: poolId,
      members: [...members].sort(),
      currency: rows[0].campaign.currency,
      status: "READY",
      impressions: I.toString(),
      clicks: C.toString(),
      conversions: V.toString(),
      spend_minor: S.toString(),
      revenue_minor: R.toString(),
      ctr: ctrR ? { status: "DEFINED", numerator: ctrR.n.toString(), denominator: ctrR.d.toString(), display: formatPercent(ctrR) } : undefinedRate(),
      conversion_rate: cvrR ? { status: "DEFINED", numerator: cvrR.n.toString(), denominator: cvrR.d.toString(), display: formatPercent(cvrR) } : undefinedRate(),
      roas: roasR ? { status: "DEFINED", numerator: roasR.n.toString(), denominator: roasR.d.toString(), display: formatRoas(roasR) } : undefinedRate(),
      citations: poolCitations,
    });
  });
  return pooled;
}

function computedMetricValue(metric, metricName) {
  switch (metricName) {
    case "CTR":
      return metric.ctr;
    case "CONVERSION_RATE":
      return metric.conversion_rate;
    case "ROAS":
      return metric.roas;
    case "IMPRESSIONS":
      return metric.impressions;
    case "CLICKS":
      return metric.clicks;
    case "CONVERSIONS":
      return metric.conversions;
    case "SPEND_MINOR":
      return metric.spend_minor;
    case "REVENUE_MINOR":
      return metric.revenue_minor;
    default:
      return undefined;
  }
}

/**
 * Header-claim comparison at the same grain (campaign + task period +
 * campaign currency). Exact rational/integer comparison — display
 * rounding is never used. Mismatches preserve both values. Quarantined
 * claims are never compared (evidence is never upgraded). A claim whose
 * period/currency does not match the task/campaign grain is UNCOMPARABLE.
 * Null/unavailable computed counts yield UNCOMPARABLE, never an exception.
 */
export function compareHeaderClaims(wrappedRows, sx) {
  const out = [];
  for (const w of wrappedRows) {
    const row = w.row;
    // 2 spans: claim identity + comparison. Evidence spans add 1 each.
    sx.budget.chargeSpan(2);
    // Cite the claim row bytes (even if quarantined — the bytes exist).
    const bytes = sx.fixtureBytes.get(w.fixture_id);
    let rowCitation;
    if (bytes && w.byte_span) {
      sx.budget.chargeSpan(1);
      try {
        rowCitation = makeCitation(bytes, w.byte_span[0], w.byte_span[1], w.source_ref);
      } catch {
        rowCitation = unavailableCitation("source row bytes not retained", w.source_ref);
      }
    } else {
      rowCitation = unavailableCitation("source row bytes not retained", w.source_ref);
    }
    sx.markUsed(w.fixture_id);
    const hits = scanRow("header_claims", row);
    if (hits.length > 0) {
      const h = hits[0];
      sx.quarantine(w.fixture_id, row.claim_id, h.family, `header_claims.${h.field} matched injection family ${h.family}; claim quarantined, never compared`, w.source_ref);
      sx.diag("INSTRUCTION_INJECTION", "warning", w.source_ref, row.claim_id, `quarantined header claim (${h.family}); not compared`);
      out.push({ claim_id: row.claim_id, campaign_id: row.campaign_id, metric: row.metric, status: "QUARANTINED", match: null, claimed: row.claimed_value, computed: null, citations: [rowCitation] });
      continue;
    }
    // Evidence-span verification: half-open UTF-8 byte ranges of the
    // claim's own fixture bytes; quoted_span must equal the slice.
    // Construct verified Citations for the evidence spans.
    let spansOk = true;
    const evidenceCitations = [];
    for (const sp of row.evidence_spans ?? []) {
      sx.budget.chargeSpan(1);
      const slice = bytes.toString("utf8", sp.start_byte, sp.end_byte);
      if (sp.start_byte > bytes.length || sp.end_byte > bytes.length || slice !== sp.quoted_text) {
        spansOk = false;
        sx.diag("SPAN_MISMATCH", "warning", w.source_ref, row.claim_id, `evidence span [${sp.start_byte},${sp.end_byte}) does not match fixture bytes`);
        break;
      }
      sx.budget.chargeSpan(1); // citation evidence span
      evidenceCitations.push(makeCitation(bytes, sp.start_byte, sp.end_byte, w.source_ref));
    }
    const allCitations = [rowCitation, ...evidenceCitations];
    const metric = sx.metrics.get(row.campaign_id);
    const campaign = sx.campaigns.get(row.campaign_id);
    // Grain enforcement: claim period/currency must match task/campaign.
    const grainOk =
      spansOk &&
      metric !== undefined &&
      campaign !== undefined &&
      row.period_start === sx.periodIsoStart &&
      row.period_end === sx.periodIsoEnd &&
      row.currency === campaign.currency;
    if (!grainOk) {
      if (spansOk && metric !== undefined && campaign !== undefined) {
        sx.diag("HEADER_GRAIN_MISMATCH", "warning", w.source_ref, row.claim_id, `header claim grain (period/currency) does not match task/campaign grain; uncomparable`);
      }
      out.push({ claim_id: row.claim_id, campaign_id: row.campaign_id, metric: row.metric, status: "UNCOMPARABLE", match: null, claimed: row.claimed_value, computed: null, citations: allCitations });
      continue;
    }
    const computed = computedMetricValue(metric, row.metric);
    // Null/unavailable computed values: UNCOMPARABLE, never an exception.
    if (computed === null || computed === undefined) {
      out.push({ claim_id: row.claim_id, campaign_id: row.campaign_id, metric: row.metric, status: "UNCOMPARABLE", match: null, claimed: row.claimed_value, computed: null, citations: allCitations });
      continue;
    }
    const computedDisplay =
      typeof computed === "object" ? computed.display : String(computed);
    const claimedUndefined = row.claimed_value === "UNDEFINED";
    let status;
    let match = null;
    if (typeof computed === "object" && (computed.status === "UNAVAILABLE" || computed.status === "UNVERIFIABLE")) {
      status = "UNCOMPARABLE";
    } else if (typeof computed === "object" && computed.status === "UNDEFINED") {
      status = claimedUndefined ? "MATCH" : "MISMATCH";
      match = claimedUndefined;
    } else if (claimedUndefined) {
      status = "MISMATCH";
      match = false;
    } else if (row.metric === "CTR" || row.metric === "CONVERSION_RATE" || row.metric === "ROAS") {
      const claimed = parseDecimal(row.claimed_value);
      const exact = rat(BigInt(computed.numerator), BigInt(computed.denominator));
      match = claimed !== null && ratEq(claimed, exact);
      status = match ? "MATCH" : "MISMATCH";
    } else {
      // Integer metrics: guard null/undefined before BigInt.
      if (computed === null || computed === undefined) {
        status = "UNCOMPARABLE";
      } else {
        const m = /^(\d+)$/.exec(String(row.claimed_value).trim());
        let cmpOk = false;
        try {
          cmpOk = m !== null && BigInt(m[1]).toString() === BigInt(computed).toString();
        } catch {
          cmpOk = false;
        }
        match = cmpOk;
        status = match ? "MATCH" : "MISMATCH";
      }
    }
    if (status === "MISMATCH") {
      sx.diag("HEADER_MISMATCH", "warning", w.source_ref, row.claim_id, `header claims ${row.claimed_value} but recomputed ${computedDisplay} for ${row.metric}; both preserved`);
    }
    out.push({
      claim_id: row.claim_id,
      campaign_id: row.campaign_id,
      metric: row.metric,
      status,
      match,
      claimed: row.claimed_value,
      computed: computedDisplay,
      citations: allCitations,
    });
  }
  return out;
}

/** Exact-string helper for diagnostics (not for comparisons). */
export function exactOf(r) {
  return exactString(r);
}
