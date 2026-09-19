// buildLeaseSigningSteps: pure mapping of a lease's real e-signature round into
// StatusTimeline steps. The data this panel already receives carries everything:
// preparationId/versionNumber (the prepared terms), per-signer signatures
// (displayName + signedAt), whether the viewing tenant signed, and the total tenant
// count. No stages are invented -- unsigned tenants are only ever named by count,
// because the data does not name them.
const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function formatDateTime(iso) {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "" : dateTime.format(new Date(time));
}

/**
 * @param {{ versionNumber?: number|string, signatures?: Array<{ displayName?: string, signedAt?: string }>, totalTenants?: number, signedByMe?: boolean, mySignedAt?: string }} input
 * @returns {Array<{ label: string, state: "complete"|"current"|"upcoming"|"failed", detail?: string }>}
 */
export function buildLeaseSigningSteps({ versionNumber, signatures = [], totalTenants = 0, signedByMe = false, mySignedAt = "" } = {}) {
  const signed = Array.isArray(signatures) ? signatures : [];
  const total = Number(totalTenants) || 0;
  const signedCount = signed.length;
  const allSigned = total > 0 && signedCount >= total;
  const mine = signedByMe && mySignedAt ? `You signed ${formatDateTime(mySignedAt)}.` : signedByMe ? "You signed." : "Your signature is needed.";
  const steps = [
    {
      label: "Lease prepared",
      state: "complete",
      ...(versionNumber ? { detail: `Terms version ${versionNumber} sent for signature.` } : {}),
    },
  ];
  if (total === 0) {
    steps.push({ label: "No signatures required", state: "current" });
    return steps;
  }
  steps.push({
    label: `Tenant signatures — ${Math.min(signedCount, total)} of ${total}`,
    state: allSigned ? "complete" : "current",
    detail: mine,
  });
  steps.push({ label: "Completed", state: allSigned ? "complete" : "upcoming" });
  return steps;
}
