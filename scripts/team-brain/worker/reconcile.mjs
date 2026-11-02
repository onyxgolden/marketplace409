// Team Brain P7 — reconcile-only outbox / run report.
//
// Reconcile READS and REPORTS; it never writes. There is deliberately
// no apply function in this module: a discrepancy is evidence for
// the operator (and, for obligations, for Jason), not something the
// worker fixes on its own. The report carries ids, states, and
// counts only — never episode text, never payload bodies.
//
// Categories:
//   pending — work started but not finished: INCOMPLETE runs,
//     non-COMPLETE handoffs, run bindings with no finalized run row.
//   unknown — records that break an invariant: COMPLETED runs with
//     no receipt, checkpoints/bindings whose run date has no run row
//     and no binding (orphans). Normally zero; the probe checks the
//     invariant instead of assuming it.

export async function reconcileReport(db) {
  const incomplete = await db.query(
    "SELECT run_date FROM tb_consolidation_runs WHERE state = 'INCOMPLETE' ORDER BY run_date",
  );
  const openHandoffs = await db.query(
    "SELECT handoff_id, state FROM team_brain_handoffs WHERE state <> 'COMPLETE' ORDER BY handoff_id",
  );
  const bindings = await db.query(
    `SELECT b.run_date FROM tb_consolidation_run_bindings b
     LEFT JOIN tb_consolidation_runs r ON r.run_date = b.run_date
     WHERE r.run_date IS NULL ORDER BY b.run_date`,
  );
  const noReceipt = await db.query(
    "SELECT run_date FROM tb_consolidation_runs WHERE state = 'COMPLETED' AND receipt IS NULL ORDER BY run_date",
  );
  const orphanCheckpoints = await db.query(
    `SELECT DISTINCT c.run_date FROM tb_consolidation_checkpoints c
     LEFT JOIN tb_consolidation_runs r ON r.run_date = c.run_date
     LEFT JOIN tb_consolidation_run_bindings b ON b.run_date = c.run_date
     WHERE r.run_date IS NULL AND b.run_date IS NULL ORDER BY c.run_date`,
  );
  return {
    pending: {
      incompleteRuns: incomplete.rows.map((r) => r.run_date),
      openHandoffs: openHandoffs.rows.map((r) => ({ handoffId: r.handoff_id, state: r.state })),
      unfinishedBindings: bindings.rows.map((r) => r.run_date),
    },
    unknown: {
      completedWithoutReceipt: noReceipt.rows.map((r) => r.run_date),
      orphanCheckpoints: orphanCheckpoints.rows.map((r) => r.run_date),
    },
  };
}
