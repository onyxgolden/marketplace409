// FORGE External Accounts Register — status-report section builder.
//
// Pure function: takes rows the caller already fetched through RLS
// (owner-authorized, household-scoped) and returns the
// "External accounts and dependent work" section every FORGE status
// report must carry (brief §5).
//
// Privacy rule, enforced here and tested: the section NEVER carries an
// account email or a credential locator. Provider names, counts, and
// follow-up actions only.
//
// Stale (brief §5): an entry whose setup is in_progress or blocked
// with no last_verified_at, OR any entry whose last_verified_at is
// more than 90 days old.

const STALE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RADAR_THREAD_LABEL = "Property Risk Radar";

/** True when the row counts as stale per the rule above. */
export function isStaleExternalAccount(account, now = new Date()) {
  const lastVerified = account.last_verified_at
    ? new Date(account.last_verified_at)
    : null;
  if (account.setup_status === "in_progress" || account.setup_status === "blocked") {
    if (!lastVerified || Number.isNaN(lastVerified.getTime())) return true;
  }
  if (lastVerified && !Number.isNaN(lastVerified.getTime())) {
    return now.getTime() - lastVerified.getTime() > STALE_DAYS * MS_PER_DAY;
  }
  return false;
}

function staleReason(account, now) {
  if (!account.last_verified_at) {
    return `setup is ${account.setup_status} and it has never been verified`;
  }
  const days = Math.floor(
    (now.getTime() - new Date(account.last_verified_at).getTime()) / MS_PER_DAY,
  );
  return `last verified ${days} days ago (over ${STALE_DAYS} days)`;
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = row[key] ?? "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/**
 * Compare the current account set against a prior report section and
 * list provider changes. `previous` is a prior section object as
 * returned by this builder (or null on the first report).
 */
export function diffExternalAccountsSincePriorReport(accounts, previous) {
  if (!previous || !Array.isArray(previous.account_states)) return [];
  const priorByKey = new Map(
    previous.account_states.map((state) => [state.seed_key ?? state.id, state]),
  );
  const changes = [];
  for (const account of accounts) {
    const key = account.seed_key ?? account.id;
    const prior = priorByKey.get(key);
    if (!prior) {
      changes.push({ provider: account.provider, change: "added" });
      continue;
    }
    for (const field of ["record_status", "setup_status", "api_integration_status", "still_needed"]) {
      if (prior[field] !== account[field]) {
        changes.push({
          provider: account.provider,
          change: `${field}: ${String(prior[field])} → ${String(account[field])}`,
        });
      }
    }
  }
  for (const prior of previous.account_states) {
    const key = prior.seed_key ?? prior.id;
    if (!accounts.some((account) => (account.seed_key ?? account.id) === key)) {
      changes.push({ provider: prior.provider, change: "removed" });
    }
  }
  return changes;
}

/**
 * Build the "External accounts and dependent work" section.
 *
 * @param {object} input
 * @param {Array} input.accounts - forge_external_accounts rows (RLS-filtered by the caller)
 * @param {Array} input.threads - forge_external_account_threads rows (RLS-filtered by the caller)
 * @param {object|null} input.previousReport - prior section object, or null
 * @param {Date} [input.generatedAt] - generation time (defaults to now)
 */
export function buildExternalAccountStatusSection({
  accounts = [],
  threads = [],
  previousReport = null,
  generatedAt = new Date(),
} = {}) {
  const now = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);

  const byRecordStatus = countBy(accounts, "record_status");
  const bySetupStatus = countBy(accounts, "setup_status");

  const blocked = accounts.filter((a) => a.setup_status === "blocked");
  const inProgress = accounts.filter((a) => a.setup_status === "in_progress");
  const neededNotIntegrated = accounts.filter(
    (a) => a.still_needed === true && a.api_integration_status === "not_integrated",
  );
  const stale = accounts.filter((a) => isStaleExternalAccount(a, now));

  const openThreads = threads.filter((t) => t.state === "open");
  const blockedThreads = threads.filter((t) => t.state === "blocked");
  const waitingThreads = threads.filter((t) => t.state === "waiting");

  // Follow-ups, prioritized: blocked setup, then in-progress unverified,
  // then needed-but-not-integrated, then blocked threads, then stale.
  const followUps = [];
  for (const account of blocked) {
    followUps.push({
      priority: 1,
      kind: "setup_blocked",
      provider: account.provider,
      text: `${account.provider}: setup is blocked — see the register for the next step.`,
    });
  }
  for (const account of inProgress) {
    followUps.push({
      priority: 2,
      kind: "setup_in_progress",
      provider: account.provider,
      text: `${account.provider}: setup is still in progress and needs finishing.`,
    });
  }
  for (const account of neededNotIntegrated) {
    followUps.push({
      priority: 3,
      kind: "needed_not_integrated",
      provider: account.provider,
      text: `${account.provider}: still needed but not integrated with FORGE yet.`,
    });
  }
  for (const thread of blockedThreads) {
    followUps.push({
      priority: 4,
      kind: "thread_blocked",
      provider: thread.account_provider ?? null,
      text: `Blocked thread: ${thread.title} — ${thread.next_action ?? "no next action recorded."}`,
    });
  }
  for (const account of stale) {
    if (blocked.includes(account) || inProgress.includes(account)) continue;
    followUps.push({
      priority: 5,
      kind: "stale_entry",
      provider: account.provider,
      text: `${account.provider}: ${staleReason(account, now)} — re-verify it.`,
    });
  }
  followUps.sort((a, b) => a.priority - b.priority);

  // Property Risk Radar cross-check (brief §5 must-pass fixture).
  const radarAccounts = accounts.filter((a) => a.work_thread_label === RADAR_THREAD_LABEL);
  const radarThreads = threads.filter(
    (t) => t.title && t.title.startsWith("Property Risk Radar"),
  );
  const radarOpenThreads = radarThreads.filter((t) =>
    ["open", "blocked", "waiting"].includes(t.state),
  );
  const radarStatus =
    radarAccounts.length === 0 && radarThreads.length === 0
      ? "not_seeded"
      : radarOpenThreads.length > 0
        ? "open_not_built"
        : "in_progress";
  const radar = {
    status: radarStatus,
    prospective_source_count: radarAccounts.length,
    open_thread_count: radarOpenThreads.length,
    open_threads: radarOpenThreads.map((t) => ({
      title: t.title,
      state: t.state,
      next_action: t.next_action ?? null,
    })),
    note:
      radarStatus === "open_not_built"
        ? "Property Risk Radar is scoped (Oct 16) and not built — its prospective sources are still being evaluated and its threads are open."
        : radarStatus === "not_seeded"
          ? "Property Risk Radar has no sources or threads in the register yet."
          : "Property Risk Radar has no open threads.",
  };

  const changes = diffExternalAccountsSincePriorReport(accounts, previousReport);

  return {
    section: "external_accounts",
    title: "External accounts and dependent work",
    generated_at: now.toISOString(),
    summary: `${accounts.length} external accounts tracked: ${byRecordStatus.confirmed_account ?? 0} confirmed, ${byRecordStatus.unverified_lead ?? 0} unverified leads, ${byRecordStatus.evaluating_service ?? 0} being evaluated. ${blocked.length} blocked, ${inProgress.length} in progress, ${neededNotIntegrated.length} needed but not integrated, ${stale.length} stale. ${openThreads.length} open threads, ${blockedThreads.length} blocked, ${waitingThreads.length} waiting.`,
    counts: {
      total: accounts.length,
      by_record_status: byRecordStatus,
      by_setup_status: bySetupStatus,
      unverified_lead: byRecordStatus.unverified_lead ?? 0,
      setup_blocked: blocked.length,
      setup_in_progress: inProgress.length,
      needed_but_not_integrated: neededNotIntegrated.length,
      stale: stale.length,
      open_threads: openThreads.length,
      blocked_threads: blockedThreads.length,
      waiting_threads: waitingThreads.length,
    },
    follow_ups: followUps,
    stale_entries: stale.map((account) => ({
      provider: account.provider,
      reason: staleReason(account, now),
    })),
    radar,
    changes_since_prior_report: changes,
    // Minimal state snapshot so the NEXT report can diff against this one.
    // Provider names + statuses only — never emails or locators.
    account_states: accounts.map((account) => ({
      id: account.id ?? null,
      seed_key: account.seed_key ?? null,
      provider: account.provider,
      record_status: account.record_status,
      setup_status: account.setup_status,
      api_integration_status: account.api_integration_status,
      still_needed: account.still_needed,
    })),
  };
}

export { RADAR_THREAD_LABEL, STALE_DAYS };
