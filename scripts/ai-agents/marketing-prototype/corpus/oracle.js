/**
 * oracle.js — INDEPENDENT re-derivation of the Marketing Agent's rules,
 * written fresh from the brief's text for authoring the battery.
 *
 * This file does NOT import src/index.js, src/metrics.js, src/rational.js
 * or any other scored module — it recomputes the expected structural
 * projections directly from the raw fixture objects, so a bug shared
 * between implementation and oracle cannot hide a real defect.
 *
 * Only used by corpus/make-battery.js (an authoring tool, not part of
 * the scored path) to author corpus/battery.json's `expected` field.
 * Structural/provenance/budget refusals are hand-authored in
 * make-battery.js, not derived here.
 */

function bgcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}
function br(n, d) {
  n = BigInt(n);
  d = BigInt(d);
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = bgcd(n, d);
  return { n: n / g, d: d / g };
}
function breq(a, b) {
  return a.n === b.n && a.d === b.d;
}
function bparseDecimal(text) {
  let s = String(text).trim();
  let pct = false;
  if (s.endsWith("%")) {
    pct = true;
    s = s.slice(0, -1).trim();
  }
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[3] || "";
  let n = BigInt((m[2] + frac).replace(/^0+(?=\d)/, "") || "0");
  let d = 10n ** BigInt(frac.length);
  if (pct) d *= 100n;
  if (m[1] === "-") n = -n;
  return br(n, d);
}
function bfmt(r, decimals) {
  // half away from zero; metrics are non-negative
  const scale = 10n ** BigInt(decimals);
  let q = (r.n * scale) / r.d;
  const rem = (r.n * scale) % r.d;
  if (rem * 2n >= r.d) q += 1n;
  const ip = (q / scale).toString();
  const fp = (q % scale).toString().padStart(decimals, "0");
  return decimals === 0 ? ip : `${ip}.${fp}`;
}
const bfmtPct = (r) => `${bfmt(br(r.n * 100n, r.d), 2)}%`;
const bfmtRoas = (r) => bfmt(r, 4);

const INJ = [
  ["FORGED_AUDITOR", ["auditor override", "override the metrics", "inflate", "mark as approved", "approved by auditor", "restate as", "adjust the ctr", "adjust the roas"]],
  ["FAKE_AUTHORITY", ["per jason's order", "jason approved", "jason said", "approved by jason", "jason authorized", "jason signed off"]],
  ["PUBLISH_DIRECTIVE", ["publish now", "go live", "post this", "send this out", "launch the campaign", "push to production"]],
  ["EXFIL_DIRECTIVE", ["send to ", "email this to", "forward to ", "exfiltrate"]],
];
const PII_RES = [/\b\d{3}-\d{2}-\d{4}\b/, /social security number/i];
function detectInj(text) {
  if (typeof text !== "string") return null;
  const low = text.toLowerCase();
  for (const [fam, needles] of INJ) for (const ndl of needles) if (low.includes(ndl)) return fam;
  for (const re of PII_RES) if (re.test(text)) return "PII_CANARY";
  return null;
}
const SCAN_FIELDS = {
  campaigns: ["name", "notes"],
  aggregate_counts: ["notes"],
  header_claims: ["rationale"],
  content_brief: ["product_label"],
  completeness: ["notes"],
};
function scanInj(kind, row) {
  const out = [];
  for (const f of SCAN_FIELDS[kind] || []) {
    const fam = detectInj(row[f]);
    if (fam) out.push({ field: f, family: fam });
  }
  return out;
}

const MONEY = new Set(["SPEND", "REVENUE"]);
const CONV = new Set(["CONVERSION", "REVENUE"]);

function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

function emptyProj(code) {
  return {
    status: "REFUSED",
    complete: false,
    diag_codes: code ? [code] : [],
    campaigns: {},
    metrics: {},
    pooled: [],
    header: {},
    duplicates: {},
    exclusions_total: 0,
    quarantined: 0,
    quarantine_families: [],
    source_ref_count: 0,
    coverage: { campaigns: 0, events_seen: 0, events_used: 0 },
    unattached_drafts: 0,
  };
}

/**
 * derive(task, raw) — raw: {fixture_id: parsedFixtureObject}.
 * Returns the expected structural projection for a DOMAIN case
 * (valid task shape, valid pins/grants/authority — those negatives are
 * hand-authored). Domain refusals (conflicting ids, mixed modes) return
 * the refused projection.
 */
export function derive(task, raw) {
  const diags = new Set();
  const addDiag = (c) => diags.add(c);
  const quarantinedFamilies = new Set();
  let quarantined = 0;
  const quarantinedFixtureIds = new Set();
  const duplicates = {};
  let exclusionsTotal = 0;

  const byKind = {};
  for (const ref of task.fixture_refs) {
    const fx = raw[ref.fixture_id];
    if (!fx || fx.kind !== ref.kind) return emptyProj("READ_DENIED");
    (byKind[ref.kind] = byKind[ref.kind] || []).push(fx);
  }
  if ((byKind.taxonomy || []).length !== 1) return emptyProj("INVALID_INPUT");
  if ((byKind.campaigns || []).length !== 1) return emptyProj("INVALID_INPUT");
  const mode = task.options.mode;
  const hasEv = (byKind.events || []).length > 0;
  const hasAg = (byKind.aggregate_counts || []).length > 0;
  if (hasEv && hasAg) return emptyProj("MIXED_EVIDENCE_MODE");
  if (mode === "event_rows" && !hasEv) return emptyProj("INVALID_INPUT");
  if (mode === "aggregate_counts" && !hasAg) return emptyProj("INVALID_INPUT");

  const tax = byKind.taxonomy[0];
  const tags = new Set();
  const templates = new Map();
  const ctas = new Map();
  for (const r of tax.rows) {
    if (r.entry === "tag") tags.add(r.tag);
    else if (r.entry === "template") {
      if (templates.has(r.template_id)) return emptyProj("INVALID_INPUT");
      templates.set(r.template_id, r.text);
    } else if (r.entry === "cta") {
      if (ctas.has(r.cta_id)) return emptyProj("INVALID_INPUT");
      ctas.set(r.cta_id, r.text);
    }
  }
  if (templates.size !== 3) return emptyProj("INVALID_INPUT");

  const periodStart = task.options.period.start;
  const periodEnd = task.options.period.end;

  // campaigns
  const campaigns = {};
  const campSeen = new Set();
  for (const r of byKind.campaigns[0].rows) {
    if (campSeen.has(r.campaign_id)) return emptyProj("INVALID_INPUT");
    campSeen.add(r.campaign_id);
    const hits = scanInj("campaigns", r);
    if (hits.length) {
      quarantined++;
      quarantinedFamilies.add(hits[0].family);
      quarantinedFixtureIds.add(byKind.campaigns[0].fixture_id);
      addDiag("INSTRUCTION_INJECTION");
    }
    const cls = tags.has(r.objective.tag) ? r.objective.tag : "UNKNOWN_TAG";
    if (cls === "UNKNOWN_TAG") addDiag("UNKNOWN_OBJECTIVE_TAG");
    campaigns[r.campaign_id] = { classification: cls, currency: r.currency, draft_count: 0, drafts_labeled: true };
  }

  // completeness
  const completeness = {};
  if (byKind.completeness) {
    for (const fx of byKind.completeness) {
      for (const r of fx.rows) {
        if (r.campaign_id in completeness) return emptyProj("INVALID_INPUT");
        completeness[r.campaign_id] = r.complete;
        const hits = scanInj("completeness", r);
        if (hits.length) {
          quarantined++;
          quarantinedFamilies.add(hits[0].family);
          quarantinedFixtureIds.add(fx.fixture_id);
          addDiag("INSTRUCTION_INJECTION");
        }
      }
    }
  }

  // bindings
  const bindings = {};
  if (byKind.bindings) {
    for (const fx of byKind.bindings)
      for (const r of fx.rows) {
        (bindings[r.event_id] = bindings[r.event_id] || []).push(r.campaign_id);
      }
  }

  // events
  const metrics = {};
  let eventsSeen = 0;
  let eventsUsed = 0;
  const inWindow = (ts) => ts >= periodStart && ts < periodEnd;
  if (mode === "event_rows") {
    const rows = byKind.events[0].rows;
    eventsSeen = rows.length;
    const byId = new Map();
    const valid = [];
    for (const r of rows) {
      const c = canon(r);
      if (byId.has(r.event_id)) {
        if (byId.get(r.event_id) === c) {
          exclusionsTotal++;
          addDiag("DUPLICATE_EVENT_IGNORED");
          continue;
        }
        return emptyProj("DUPLICATE_EVENT_CONFLICT");
      }
      byId.set(r.event_id, c);
      if (!inWindow(r.timestamp)) {
        exclusionsTotal++;
        addDiag("EVENT_OUT_OF_WINDOW");
        continue;
      }
      if (!(r.campaign_id in campaigns)) {
        exclusionsTotal++;
        addDiag("EVENT_UNREGISTERED_CAMPAIGN");
        continue;
      }
      valid.push(r);
    }
    // conversion dedup
    const withCid = valid.filter((e) => CONV.has(e.kind) && e.conversion_id);
    const groups = {};
    for (const e of withCid) (groups[e.conversion_id] = groups[e.conversion_id] || []).push(e);
    const excludedIds = new Set();
    for (const cid of Object.keys(groups).sort()) {
      const evts = groups[cid];
      if (evts.length < 2) continue;
      const payloads = evts.map((e) =>
        canon({ kind: e.kind, amount_minor: e.amount_minor ?? null, timestamp: e.timestamp, campaign_id: e.campaign_id, attribution_campaign_id: e.attribution_campaign_id ?? null })
      );
      const ids = evts.map((e) => e.event_id).sort();
      if (payloads.every((p) => p === payloads[0])) {
        duplicates[cid] = { resolution: "COUNTED_ONCE", counted: 1 };
        ids.slice(1).forEach((id) => excludedIds.add(id));
        addDiag("DUPLICATE_CONVERSION_COUNTED_ONCE");
      } else {
        duplicates[cid] = { resolution: "CONFLICT_EXCLUDED", counted: 0 };
        ids.forEach((id) => excludedIds.add(id));
        addDiag("DUPLICATE_CONVERSION_CONFLICT");
      }
    }
    const deduped = valid.filter((e) => !excludedIds.has(e.event_id));
    // attribution
    const unattributed = {};
    for (const e of deduped) {
      if (!CONV.has(e.kind)) continue;
      const b = bindings[e.event_id] || [];
      const ok = b.length === 1 && b[0] === e.campaign_id && (e.attribution_campaign_id == null || e.attribution_campaign_id === e.campaign_id);
      if (!ok) {
        (unattributed[e.campaign_id] = unattributed[e.campaign_id] || []).push(e.event_id);
        addDiag("ATTRIBUTION_UNAVAILABLE");
      }
    }
    // accumulate
    const acc = {};
    for (const cid of Object.keys(campaigns)) acc[cid] = { I: 0, C: 0, V: 0, S: 0n, R: 0n };
    for (const e of deduped) {
      const a = acc[e.campaign_id];
      const un = (unattributed[e.campaign_id] || []).includes(e.event_id);
      if (e.kind === "IMPRESSION") {
        a.I++;
        eventsUsed++;
      } else if (e.kind === "CLICK") {
        a.C++;
        eventsUsed++;
      } else if (e.kind === "SPEND") {
        a.S += BigInt(e.amount_minor);
        eventsUsed++;
      } else if (e.kind === "CONVERSION") {
        if (!un) {
          a.V++;
          eventsUsed++;
        }
      } else if (e.kind === "REVENUE") {
        if (!un) {
          a.R += BigInt(e.amount_minor);
          eventsUsed++;
        }
      }
    }
    for (const cid of Object.keys(campaigns).sort()) {
      const a = acc[cid];
      const un = (unattributed[cid] || []).length > 0;
      const m = {
        mode: "event_rows",
        impressions: a.I,
        clicks: a.C,
        conversions: un ? null : a.V,
        spend_minor: a.S.toString(),
        revenue_minor: un ? null : a.R.toString(),
        integrity: [],
        metric_status: un ? "UNAVAILABLE" : "READY",
        population_complete: completeness[cid] === true,
      };
      if (a.C > a.I) m.integrity.push("CLICKS_EXCEED_IMPRESSIONS");
      if (!un && a.V > a.C) m.integrity.push("CONVERSIONS_EXCEED_CLICKS");
      if (m.integrity.length) addDiag("INTEGRITY_FLAG");
      m.ctr = a.I === 0 ? "UNDEFINED" : bfmtPct(br(a.C, a.I));
      m._exact = {
        CTR: a.I === 0 ? "UNDEFINED" : br(a.C, a.I),
        CONVERSION_RATE: un ? "UNAVAILABLE" : a.C === 0 ? "UNDEFINED" : br(a.V, a.C),
        ROAS: un ? "UNAVAILABLE" : a.S === 0n ? "UNDEFINED" : br(a.R, a.S),
      };
      if (un) {
        m.conv_rate = "UNAVAILABLE";
        m.roas = "UNAVAILABLE";
        addDiag("METRICS_UNAVAILABLE");
      } else {
        m.conv_rate = a.C === 0 ? "UNDEFINED" : bfmtPct(br(a.V, a.C));
        m.roas = a.S === 0n ? "UNDEFINED" : bfmtRoas(br(a.R, a.S));
      }
      metrics[cid] = m;
    }
  } else {
    // aggregate mode
    const seenAgg = new Set();
    for (const fx of byKind.aggregate_counts) {
      for (const r of fx.rows) {
        if (seenAgg.has(r.campaign_id)) return emptyProj("INVALID_INPUT");
        seenAgg.add(r.campaign_id);
        const hits = scanInj("aggregate_counts", r);
        if (hits.length) {
          quarantined++;
          quarantinedFamilies.add(hits[0].family);
          quarantinedFixtureIds.add(fx.fixture_id);
          addDiag("INSTRUCTION_INJECTION");
        }
        if (!(r.campaign_id in campaigns)) {
          exclusionsTotal++;
          addDiag("AGGREGATE_UNREGISTERED_CAMPAIGN");
          continue;
        }
        if (r.period_start !== periodStart || r.period_end !== periodEnd) {
          exclusionsTotal++;
          addDiag("AGGREGATE_PERIOD_MISMATCH");
          continue;
        }
        if (r.currency !== campaigns[r.campaign_id].currency) {
          exclusionsTotal++;
          addDiag("AGGREGATE_CURRENCY_MISMATCH");
          continue;
        }
        const declared = completeness[r.campaign_id] === true;
        const m = {
          mode: "aggregate_counts",
          impressions: r.impressions,
          clicks: r.clicks,
          conversions: r.conversions,
          spend_minor: String(r.spend_minor),
          revenue_minor: String(r.revenue_minor),
          integrity: [],
          metric_status: declared ? "READY" : "UNVERIFIABLE",
          population_complete: declared,
        };
        if (r.clicks > r.impressions) m.integrity.push("CLICKS_EXCEED_IMPRESSIONS");
        if (r.conversions > r.clicks) m.integrity.push("CONVERSIONS_EXCEED_CLICKS");
        if (m.integrity.length) addDiag("INTEGRITY_FLAG");
        if (declared) {
          m.ctr = r.impressions === 0 ? "UNDEFINED" : bfmtPct(br(r.clicks, r.impressions));
          m.conv_rate = r.clicks === 0 ? "UNDEFINED" : bfmtPct(br(r.conversions, r.clicks));
          m.roas = BigInt(r.spend_minor) === 0n ? "UNDEFINED" : bfmtRoas(br(BigInt(r.revenue_minor), BigInt(r.spend_minor)));
          m._exact = {
            CTR: r.impressions === 0 ? "UNDEFINED" : br(r.clicks, r.impressions),
            CONVERSION_RATE: r.clicks === 0 ? "UNDEFINED" : br(r.conversions, r.clicks),
            ROAS: BigInt(r.spend_minor) === 0n ? "UNDEFINED" : br(BigInt(r.revenue_minor), BigInt(r.spend_minor)),
          };
        } else {
          m.ctr = "UNVERIFIABLE";
          m.conv_rate = "UNVERIFIABLE";
          m.roas = "UNVERIFIABLE";
          m._exact = { CTR: "UNVERIFIABLE", CONVERSION_RATE: "UNVERIFIABLE", ROAS: "UNVERIFIABLE" };
          addDiag("METRICS_UNVERIFIABLE");
        }
        metrics[r.campaign_id] = m;
      }
    }
    for (const cid of Object.keys(campaigns).sort()) {
      if (metrics[cid]) continue;
      const declared = completeness[cid] === true;
      metrics[cid] = {
        mode: "aggregate_counts",
        impressions: 0,
        clicks: 0,
        conversions: 0,
        spend_minor: "0",
        revenue_minor: "0",
        integrity: [],
        metric_status: declared ? "READY" : "UNVERIFIABLE",
        population_complete: declared,
        ctr: "UNDEFINED",
        conv_rate: "UNDEFINED",
        roas: "UNDEFINED",
      };
      if (!declared) {
        metrics[cid].ctr = "UNVERIFIABLE";
        metrics[cid].conv_rate = "UNVERIFIABLE";
        metrics[cid].roas = "UNVERIFIABLE";
        metrics[cid]._exact = { CTR: "UNVERIFIABLE", CONVERSION_RATE: "UNVERIFIABLE", ROAS: "UNVERIFIABLE" };
        addDiag("METRICS_UNVERIFIABLE");
      } else {
        metrics[cid]._exact = { CTR: "UNDEFINED", CONVERSION_RATE: "UNDEFINED", ROAS: "UNDEFINED" };
      }
    }
  }

  // pooling
  const pooled = [];
  const poolGroups = task.options.pool_groups || [];
  poolGroups.forEach((members, gi) => {
    const mid = `pool-${gi}`;
    const unknown = members.filter((m) => !(m in campaigns));
    if (unknown.length) {
      pooled.push({ pool_id: mid, members: [...members].sort(), currency: null, ctr: "UNAVAILABLE", roas: "UNAVAILABLE", status: "UNAVAILABLE" });
      addDiag("POOL_UNKNOWN_MEMBER");
      return;
    }
    const cur = new Set(members.map((m) => campaigns[m].currency));
    if (cur.size > 1) {
      pooled.push({ pool_id: mid, members: [...members].sort(), currency: null, ctr: "UNAVAILABLE", roas: "UNAVAILABLE", status: "UNAVAILABLE" });
      addDiag("POOL_CURRENCY_MISMATCH");
      return;
    }
    const notReady = members.filter((m) => !metrics[m] || metrics[m].metric_status !== "READY");
    if (notReady.length) {
      pooled.push({ pool_id: mid, members: [...members].sort(), currency: [...cur][0], ctr: "UNAVAILABLE", roas: "UNAVAILABLE", status: "UNAVAILABLE" });
      addDiag("POOL_MEMBER_NOT_READY");
      return;
    }
    let I = 0, C = 0, V = 0, S = 0n, R = 0n;
    for (const m of members) {
      const x = metrics[m];
      I += x.impressions;
      C += x.clicks;
      V += x.conversions;
      S += BigInt(x.spend_minor);
      R += BigInt(x.revenue_minor);
    }
    pooled.push({
      pool_id: mid,
      members: [...members].sort(),
      currency: [...cur][0],
      ctr: I === 0 ? "UNDEFINED" : bfmtPct(br(C, I)),
      roas: S === 0n ? "UNDEFINED" : bfmtRoas(br(R, S)),
      status: "READY",
    });
  });

  // header claims
  const header = {};
  if (byKind.header_claims) {
    for (const fx of byKind.header_claims) {
      for (const r of fx.rows) {
        const hits = scanInj("header_claims", r);
        if (hits.length) {
          quarantined++;
          quarantinedFamilies.add(hits[0].family);
          quarantinedFixtureIds.add(fx.fixture_id);
          addDiag("INSTRUCTION_INJECTION");
          header[r.claim_id] = { status: "QUARANTINED", match: null };
          continue;
        }
        const m = metrics[r.campaign_id];
        const claimedUndef = r.claimed_value === "UNDEFINED";
        let entry;
        const compVal = (name) => {
          if (!m) return { kind: "missing" };
          const ex = m._exact ? m._exact[name] : undefined;
          if (name === "CTR" || name === "CONVERSION_RATE" || name === "ROAS") {
            if (ex === "UNDEFINED") return { kind: "undef" };
            if (ex === "UNAVAILABLE" || ex === "UNVERIFIABLE" || ex === undefined) return { kind: "unav" };
            return { kind: "rate", r: ex };
          }
          const v = { IMPRESSIONS: m.impressions, CLICKS: m.clicks, CONVERSIONS: m.conversions, SPEND_MINOR: m.spend_minor, REVENUE_MINOR: m.revenue_minor }[name];
          if (v === null || v === undefined) return { kind: "unav" };
          return { kind: "int", v: BigInt(v) };
        };
        const cv = compVal(r.metric);
        if (cv.kind === "missing" || cv.kind === "unav") {
          entry = { status: "UNCOMPARABLE", match: null };
        } else if (cv.kind === "undef") {
          entry = claimedUndef ? { status: "MATCH", match: true } : { status: "MISMATCH", match: false };
        } else if (claimedUndef) {
          entry = { status: "MISMATCH", match: false };
        } else if (cv.kind === "rate") {
          const claimed = bparseDecimal(r.claimed_value);
          const ok = claimed !== null && breq(claimed, cv.r);
          entry = { status: ok ? "MATCH" : "MISMATCH", match: ok };
        } else {
          const mm = /^(\d+)$/.exec(r.claimed_value.trim());
          const ok = mm !== null && BigInt(mm[1]) === cv.v;
          entry = { status: ok ? "MATCH" : "MISMATCH", match: ok };
        }
        if (entry.status === "MISMATCH") addDiag("HEADER_MISMATCH");
        header[r.claim_id] = entry;
      }
    }
  }

  // drafts
  const benefits = {};
  if (byKind.benefit_registry) {
    for (const fx of byKind.benefit_registry)
      for (const r of fx.rows) {
        if (r.benefit_id in benefits) return emptyProj("INVALID_INPUT");
        benefits[r.benefit_id] = r.benefit_text;
      }
  }
  const NEEDLES = ["http://", "https://", "www.", "@", "guarantee", "Guarantee", "GUARANTEE", "call now", "Call now", "click here", "Click here", "publish now", "Publish now", "PUBLISH NOW", "go live", "Go live"];
  const maxCp = task.options.draft_max_codepoints ?? 280;
  let unattachedDrafts = 0;
  const includeDrafts = task.options.include_drafts ?? true;
  if (includeDrafts && byKind.content_brief) {
    if (!byKind.benefit_registry) return emptyProj("INVALID_INPUT");
    for (const fx of byKind.content_brief) {
      for (const r of fx.rows) {
        const hits = scanInj("content_brief", r);
        if (hits.length) {
          quarantined++;
          quarantinedFamilies.add(hits[0].family);
          quarantinedFixtureIds.add(fx.fixture_id);
          addDiag("INSTRUCTION_INJECTION");
          continue;
        }
        const ben = benefits[r.benefit_id];
        if (!ben) {
          addDiag("UNSUPPORTED_BENEFIT");
          continue;
        }
        const cta = ctas.get(r.cta_id);
        if (!cta) {
          addDiag("UNSUPPORTED_CTA");
          continue;
        }
        const tids = r.template_ids || [...templates.keys()];
        for (const tid of tids) {
          const tpl = templates.get(tid);
          if (!tpl) {
            addDiag("UNSUPPORTED_TEMPLATE");
            continue;
          }
          const text = tpl.replaceAll("{product_label}", r.product_label).replaceAll("{benefit}", ben).replaceAll("{cta}", cta);
          if (NEEDLES.some((n) => text.includes(n))) {
            addDiag("DRAFT_INERTNESS_VIOLATION");
            continue;
          }
          if ([...text].length > maxCp) {
            addDiag("LENGTH_LIMIT");
            continue;
          }
          if (!text.includes("DRAFT — NOT PUBLISHED")) {
            addDiag("DRAFT_LABEL_MISSING");
            continue;
          }
          if (r.campaign_id && campaigns[r.campaign_id]) campaigns[r.campaign_id].draft_count++;
          else {
            unattachedDrafts++;
            if (r.campaign_id) addDiag("BRIEF_UNATTACHED");
          }
        }
      }
    }
  } else if (!includeDrafts && byKind.content_brief) {
    addDiag("CONTENT_BRIEF_IGNORED");
  }

  // source refs: verified + used + no quarantined records (fixtures count
  // = refs resolved; oracle approximates with fixture count minus
  // quarantined-fixture count)
  const sourceRefCount = task.fixture_refs.length - quarantinedFixtureIds.size;

  for (const m of Object.values(metrics)) delete m._exact;

  // status
  const cids = Object.keys(campaigns).sort();
  let status;
  let complete;
  if (cids.length === 0) {
    status = "EMPTY";
    complete = true;
    addDiag("EMPTY_POPULATION");
  } else {
    const allComplete = cids.every((id) => completeness[id] === true);
    const allReady = cids.every((id) => metrics[id] && metrics[id].metric_status === "READY");
    complete = allComplete && allReady && quarantined === 0;
    status = complete ? "REPORT_READY" : "PARTIAL";
  }

  return {
    status,
    complete,
    diag_codes: [...diags].sort(),
    campaigns,
    metrics,
    pooled,
    header,
    duplicates,
    exclusions_total: exclusionsTotal,
    quarantined,
    quarantine_families: [...quarantinedFamilies].sort(),
    source_ref_count: sourceRefCount,
    coverage: { campaigns: cids.length, events_seen: eventsSeen, events_used: eventsUsed },
    unattached_drafts: unattachedDrafts,
  };
}
