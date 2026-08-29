"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildRentalDashboardSummary } from "@/application/rental/buildRentalDashboardSummary";
import {
  buildTodaysPrioritiesWorkflowDefinition,
  buildTodaysPrioritiesEvaluatorResults,
  createSemanticTargetRegistry,
  startGuidedWorkflowSession,
  advanceGuidedWorkflowSession,
  goBackGuidedWorkflowSession,
  pauseGuidedWorkflowSession,
  resumeGuidedWorkflowSession,
  exitGuidedWorkflowSession,
  sessionHasUnavailableSteps,
  GUIDED_WORKFLOW_SESSION_STATUS,
} from "@/domains/guided-workflow";
import { TODAYS_PRIORITIES_EXPLANATIONS } from "./todaysPrioritiesExplanations";

// Built once per module load, not per render -- the definition and registry are static/versioned by
// design (see todaysPrioritiesWorkflow.js), so there's nothing to recompute on every mount.
const WORKFLOW_DEFINITION = buildTodaysPrioritiesWorkflowDefinition(TODAYS_PRIORITIES_EXPLANATIONS);
export const TODAYS_PRIORITIES_SEMANTIC_TARGET_REGISTRY = createSemanticTargetRegistry(
  WORKFLOW_DEFINITION.steps.map((step) => ({ targetId: step.semanticTargetId, description: step.instruction })),
);

function generateSessionId() {
  return `rental-todays-priorities-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// /api/rental is a hard requirement -- every needsAttention category depends on it, so its failure
// still throws and fails the whole session, matching prior behavior exactly.
function fetchRentalData() {
  return fetch("/api/rental").then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Rental summary could not be loaded.");
    return body;
  });
}

// /api/rental/reports is NOT a hard requirement -- only 2 of the 9 needsAttention categories
// (REPORT_DEPENDENT_STEP_IDS) actually depend on it. Its failure is caught here, never thrown, and
// reported as a structured { available: false, error } result instead, so a caller can keep the
// other 7 categories working rather than failing the entire session over an unrelated endpoint.
function fetchReportsData() {
  return fetch("/api/rental/reports")
    .then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Rental report could not be loaded.");
      return { available: true, report: body.report, error: "" };
    })
    .catch((reason) => ({ available: false, report: null, error: reason.message }));
}

// Fetches the same live data source the Overview panel's needs-attention queue already uses, computes the
// real summary, and evaluates the workflow's fixed step vocabulary against it. Never fabricates a required
// step that isn't actually present in the fetched needsAttention array.
function fetchSummaryAndIdentity() {
  return fetchRentalData().then((rentalBody) => fetchReportsData().then((reportsResult) => ({
    summary: buildRentalDashboardSummary(rentalBody, reportsResult.report),
    actingUserId: rentalBody.actingUserId || null,
    canonicalOwnerId: rentalBody.canonicalOwnerId || null,
    reportsAvailable: reportsResult.available,
    reportsError: reportsResult.error,
  })));
}

export function useTodaysPrioritiesSession() {
  const [summary, setSummary] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [session, setSession] = useState(null);
  const [reportsAvailable, setReportsAvailable] = useState(true);
  const [reportsError, setReportsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sessionIdRef = useRef(generateSessionId());

  // The mount effect calls this directly (no synchronous setState before the fetch -- loading/error
  // already start at their correct initial values, so there's nothing to reset). `restart` below wraps
  // it with the explicit reset for the user-triggered "try again" path, which runs from an event
  // handler rather than an effect body.
  const runInitialize = useCallback(() => fetchSummaryAndIdentity()
    .then(({ summary: nextSummary, actingUserId, canonicalOwnerId, reportsAvailable: nextReportsAvailable, reportsError: nextReportsError }) => {
      setSummary(nextSummary);
      setIdentity({ actingUserId, canonicalOwnerId });
      setReportsAvailable(nextReportsAvailable);
      setReportsError(nextReportsError);
      if (!actingUserId || !canonicalOwnerId) {
        throw new Error("Could not determine your workspace identity -- guidance can't start safely without it.");
      }
      const now = new Date().toISOString();
      const evaluatorResults = buildTodaysPrioritiesEvaluatorResults(WORKFLOW_DEFINITION, nextSummary.needsAttention, now, { reportsAvailable: nextReportsAvailable });
      setSession(startGuidedWorkflowSession({
        sessionId: sessionIdRef.current,
        workflowDefinition: WORKFLOW_DEFINITION,
        evaluatorResults,
        actingUserId,
        canonicalOwnerId,
        now,
      }));
    })
    .catch((reason) => setError(reason.message))
    .finally(() => setLoading(false)), []);

  useEffect(() => {
    runInitialize();
  }, [runInitialize]);

  const restart = useCallback(() => {
    setLoading(true);
    setError("");
    return runInitialize();
  }, [runInitialize]);

  // Re-fetches real data before advancing, so "next" is always evaluated against current
  // authoritative state -- never against a stale in-memory guess of what's still required.
  const next = useCallback(() => {
    if (!session || !identity) return Promise.resolve();
    setLoading(true);
    setError("");
    return fetchSummaryAndIdentity()
      .then(({ summary: nextSummary, reportsAvailable: nextReportsAvailable, reportsError: nextReportsError }) => {
        setSummary(nextSummary);
        setReportsAvailable(nextReportsAvailable);
        setReportsError(nextReportsError);
        const now = new Date().toISOString();
        const evaluatorResults = buildTodaysPrioritiesEvaluatorResults(WORKFLOW_DEFINITION, nextSummary.needsAttention, now, { reportsAvailable: nextReportsAvailable });
        setSession((current) => advanceGuidedWorkflowSession(current, WORKFLOW_DEFINITION, evaluatorResults, identity.canonicalOwnerId, now));
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [session, identity]);

  // Retries the reports source. A COMPLETED session has no "current step" to preserve -- it already
  // told the landlord the (incomplete) full picture, so retry re-runs the whole evaluation from
  // scratch via restart(), exactly like a fresh mount, letting previously-unavailable categories be
  // properly evaluated instead of remaining historically stuck as unavailable forever. An ACTIVE
  // session, by contrast, is mid-review of a real priority, so retry only refreshes summary/
  // reportsAvailable in place -- currentAttentionItem re-derives automatically, and any previously
  // unavailable step re-resolves the next time Back or Next is used (both already pass fresh
  // evaluator results built from the refreshed reportsAvailable).
  const retryReports = useCallback(() => {
    if (session && session.status === GUIDED_WORKFLOW_SESSION_STATUS.COMPLETED) {
      return restart();
    }
    setLoading(true);
    setError("");
    return fetchSummaryAndIdentity()
      .then(({ summary: nextSummary, reportsAvailable: nextReportsAvailable, reportsError: nextReportsError }) => {
        setSummary(nextSummary);
        setReportsAvailable(nextReportsAvailable);
        setReportsError(nextReportsError);
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [session, restart]);

  // Pure navigation, re-derived from the last fetched summary rather than a fresh fetch -- Back is for
  // reviewing what's already been shown, not for re-confirming authoritative state (Next does that).
  const back = useCallback(() => {
    if (!session || !identity || !summary) return;
    setError("");
    const now = new Date().toISOString();
    const evaluatorResults = buildTodaysPrioritiesEvaluatorResults(WORKFLOW_DEFINITION, summary.needsAttention, now, { reportsAvailable });
    setSession((current) => goBackGuidedWorkflowSession(current, WORKFLOW_DEFINITION, evaluatorResults, identity.canonicalOwnerId, now));
  }, [session, identity, summary, reportsAvailable]);

  const pause = useCallback(() => {
    if (!session || !identity) return;
    setError("");
    setSession((current) => pauseGuidedWorkflowSession(current, identity.canonicalOwnerId, new Date().toISOString()));
  }, [session, identity]);

  const resume = useCallback(() => {
    if (!session || !identity) return;
    setError("");
    setSession((current) => resumeGuidedWorkflowSession(current, WORKFLOW_DEFINITION, identity.canonicalOwnerId, new Date().toISOString()));
  }, [session, identity]);

  const exit = useCallback(() => {
    if (!session || !identity) return;
    setError("");
    setSession((current) => exitGuidedWorkflowSession(current, identity.canonicalOwnerId, new Date().toISOString()));
  }, [session, identity]);

  const currentStep = useMemo(() => {
    if (!session || !session.currentStepId) return null;
    return WORKFLOW_DEFINITION.steps.find((step) => step.stepId === session.currentStepId) || null;
  }, [session]);

  const currentAttentionItem = useMemo(() => {
    if (!currentStep || !summary) return null;
    return summary.needsAttention.find((item) => item.id === currentStep.stepId) || null;
  }, [currentStep, summary]);

  // Mirrors goBackGuidedWorkflowSession's own rule (an earlier step must currently need attention, not
  // merely occupy an earlier index) so the Back button is never enabled for a call that would throw.
  const canGoBack = useMemo(() => {
    if (!currentStep || !summary) return false;
    const currentIndex = WORKFLOW_DEFINITION.steps.findIndex((step) => step.stepId === currentStep.stepId);
    const needsAttentionIds = new Set(summary.needsAttention.map((item) => item.id));
    return WORKFLOW_DEFINITION.steps.slice(0, currentIndex).some((step) => needsAttentionIds.has(step.stepId));
  }, [currentStep, summary]);

  // A COMPLETED session may only be presented as "nothing urgent" when every step was actually
  // evaluated -- never when a report-dependent category was skipped as UNAVAILABLE rather than
  // genuinely checked and found clear. See sessionHasUnavailableSteps's own doc comment.
  const hasUnavailablePriorities = useMemo(() => (session ? sessionHasUnavailableSteps(session) : false), [session]);

  return {
    workflowDefinition: WORKFLOW_DEFINITION,
    summary,
    session,
    currentStep,
    currentAttentionItem,
    loading,
    error,
    canGoBack,
    reportsAvailable,
    reportsError,
    hasUnavailablePriorities,
    next,
    back,
    pause,
    resume,
    exit,
    restart,
    retryReports,
  };
}
