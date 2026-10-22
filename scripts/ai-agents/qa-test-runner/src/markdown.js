/**
 * markdown.js — Markdown renderer for the canonical test-runner report.
 * Consumes the report JSON without inventing claims: every rendered line
 * traces to a field in the input. Advisory only.
 */

export function reportToMarkdown(report) {
  const lines = [];
  lines.push(`# QA test-runner report \`${report.job_id ?? "n/a"}\` (advisory)`);
  lines.push("");
  lines.push(`- target: \`${report.target ?? "n/a"}\``);
  lines.push(`- head pin: \`${report.head_pin ?? "n/a"}\``);
  lines.push(`- checkout head: \`${report.checkout_head ?? "n/a"}\``);
  lines.push(`- status: **${report.status}**`);
  lines.push(`- verdict: **${report.verdict}**`);
  if (report.reason_code) lines.push(`- reason: \`${report.reason_code}\``);
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  const t = report.totals ?? {};
  lines.push(
    `- suites: ${t.suites_total ?? 0} total, ${t.suites_passed ?? 0} passed, ${t.suites_failed ?? 0} failed, ` +
      `${t.suites_error ?? 0} error, ${t.suites_timeout ?? 0} timeout, ${t.suites_skipped_budget ?? 0} skipped (budget)`
  );
  lines.push(
    `- tests: ${t.tests_total ?? 0} total, ${t.tests_passed ?? 0} passed, ${t.tests_failed ?? 0} failed, ${t.tests_pending ?? 0} pending`
  );
  lines.push("");
  lines.push("## Suites");
  lines.push("");
  for (const s of report.suites ?? []) {
    lines.push(`### ${s.id ?? "n/a"} — ${s.status}`);
    lines.push("");
    lines.push(`- patterns: ${(s.patterns ?? []).map((p) => `\`${p}\``).join(", ") || "none"}`);
    lines.push(`- exit code: ${s.exit_code === null || s.exit_code === undefined ? "none" : s.exit_code}`);
    const c = s.test_counts ?? {};
    lines.push(`- tests: ${c.total ?? 0} total, ${c.passed ?? 0} passed, ${c.failed ?? 0} failed, ${c.pending ?? 0} pending`);
    if (s.reason) lines.push(`- reason: ${s.reason}`);
    if ((s.failing_tests ?? []).length) {
      lines.push("- failing tests:");
      for (const f of s.failing_tests) {
        lines.push(`  - ${f.name} (\`${f.file}\`)`);
      }
    }
    lines.push("");
  }
  if ((report.diagnostics ?? []).length) {
    lines.push("## Diagnostics");
    lines.push("");
    for (const d of report.diagnostics) {
      lines.push(`- [${d.code}]${d.path ? ` @ ${d.path}` : ""}: ${d.message}`);
    }
    lines.push("");
  }
  lines.push("_Advisory evidence only — this report merges nothing and approves nothing._");
  return lines.join("\n");
}
