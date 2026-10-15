/**
 * markdown.js — inert audit preview renderer.
 *
 * Renders a clearly marked SYNTHETIC / ADVISORY / NO AUTHORIZATION view of
 * the same decision JSON: classification, policy citations, pins,
 * satisfied/outstanding requirements and simulated routing flags. The
 * preview is inert — it is not filed into real reviewer namespaces and it
 * grants nothing.
 */

const BANNER = "> **SYNTHETIC / ADVISORY / NO AUTHORIZATION** — fixture-only governance prototype output. This preview classifies a hypothetical action; it grants no rights and authorizes no execution.";

function esc(s) {
  return String(s).replace(/\|/g, "\\|");
}

export function renderAuditPreview(result) {
  const lines = [];
  lines.push("# Governance advisory — audit preview");
  lines.push("");
  lines.push(BANNER);
  lines.push("");
  const b = result.evaluation_binding;
  lines.push(`- task_id: \`${esc(result.task_id)}\``);
  lines.push(`- status: \`${esc(result.status)}\`  validity: \`${esc(result.validity)}\`  classification: \`${esc(result.classification)}\`  complete: \`${result.complete}\``);
  lines.push(`- advisory: \`${result.advisory}\`  fixture_only: \`${result.fixture_only}\``);
  lines.push(`- authorization_granted: \`${result.authorization_granted}\`  execution_performed: \`${result.execution_performed}\``);
  if (b) {
    lines.push(`- evaluated: \`${esc(b.repo)}\` / \`${esc(b.resource_id)}\` (\`${esc(b.resource_class)}\`) scope [\`${b.scope_ids.map(esc).join("`, `")}\`] head \`${b.head.slice(0, 12)}…\``);
  }
  lines.push("");
  lines.push("## Policy citations");
  if ((result.policy_rule_cited ?? []).length === 0) {
    lines.push("_none_");
  } else {
    lines.push("| policy | version | rule | citation |");
    lines.push("|---|---|---|---|");
    for (const c of result.policy_rule_cited) {
      const cit = c.citation ? `${esc(c.citation.repo)}/${esc(c.citation.path)}@${c.citation.commit.slice(0, 8)} ${c.citation.verification}` : "none";
      lines.push(`| ${esc(c.policy_id)} | ${esc(c.version)} | ${esc(c.rule_id)} | ${cit} |`);
    }
  }
  lines.push("");
  lines.push("## Requirements");
  const reqs = result.requirements ?? { satisfied: [], outstanding: [] };
  lines.push("### Satisfied");
  if (reqs.satisfied.length === 0) lines.push("_none_");
  for (const r of reqs.satisfied) {
    lines.push(`- \`${esc(r.requirement_id)}\` (${esc(r.type)}): satisfied — evidence [\`${r.evidence_refs.map(esc).join("`, `")}\`]`);
  }
  lines.push("### Outstanding");
  if (reqs.outstanding.length === 0) lines.push("_none_");
  for (const r of reqs.outstanding) {
    lines.push(`- \`${esc(r.requirement_id)}\` (${esc(r.type)}): outstanding — route to \`${esc(r.responsible_actor_ref ?? "none")}\``);
  }
  lines.push("");
  lines.push("## Routing");
  lines.push(`- responsible_actor: \`${esc(result.responsible_actor ?? "none")}\``);
  lines.push(`- routing_flags: [\`${(result.routing_flags ?? []).map(esc).join("`, `")}\`]`);
  lines.push("");
  lines.push("## Evaluation pins");
  const pins = result.evaluation_pins;
  if (!pins) {
    lines.push("_none (evaluation did not ground)_");
  } else {
    for (const [k, v] of Object.entries(pins)) {
      if (k === "policy_sha256") {
        lines.push(`- policy_sha256:`);
        for (const [pk, pv] of Object.entries(v)) lines.push(`  - \`${esc(pk)}\`: \`${String(pv).slice(0, 16)}…\``);
      } else {
        lines.push(`- ${esc(k)}: \`${esc(typeof v === "string" && v.length > 24 ? v.slice(0, 16) + "…" : v)}\``);
      }
    }
  }
  lines.push("");
  lines.push("## Diagnostics");
  if ((result.diagnostics ?? []).length === 0) lines.push("_none_");
  for (const d of result.diagnostics) {
    lines.push(`- [${esc(d.severity)}] \`${esc(d.code)}\`: ${esc(d.reason)}`);
  }
  if ((result.quarantined_sources ?? []).length > 0) {
    lines.push("");
    lines.push("## Quarantined sources");
    for (const q of result.quarantined_sources) {
      lines.push(`- \`${esc(q.record_id ?? `${q.repo}/${q.path}`)}\`: ${esc(q.reason)}`);
    }
  }
  lines.push("");
  lines.push(BANNER);
  return lines.join("\n");
}
