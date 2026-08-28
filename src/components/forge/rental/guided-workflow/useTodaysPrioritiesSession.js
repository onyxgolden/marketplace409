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

// Fetches the same live data source the Overview panel's needs-attention queue already uses, computes the
// real summary, and evaluates the workflow's fixed step vocabulary against it. Never fabricates a required
// step that isn't actually present in the fetched needsAttention array.
function fetchSummaryAndIdentity() {
  return Promise.all([fetch("/api/rental"), fetch("/api/rental/reports")]).then(async ([rentalResponse, reportResponse]) => {
    const rentalBody = await rentalResponse.json();
    const reportBody = await reportResponse.json();
    if (!rentalResponse.ok) throw new Error(rentalBody.error || "Rental summary could not be loaded.");
    if (!reportResponse.ok) throw new Error(reportBody.error || "Rental report could not be loaded.");
    return {
      summary: buildRentalDashboardSummary(rentalBody, reportBody.report),
      actingUserId: rentalBody.actingUserId || null,
      canonicalOwnerId: rentalBody.canonicalOwnerId || null,
    };
  });
}

export function useTodaysPrioritiesSession() {
  const [summary, setSummary] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sessionIdRef = useRef(generateSessionId());

  // The mount effect calls this directly (no synchronous setState before the fetch -- loading/error
  // already start at their correct initial values, so there's nothing to reset). `restart` below wraps
  // it with the explicit reset for the user-triggered "try again" path, which runs from an event
  // handler rather than an effect body.
  const runInitialize = useCallback(() => fetchSummaryAndIdentity()
    .then(({ summary: nextSummary, actingUserId, canonicalOwnerId }) => {
      setSummary(nextSummary);
      setIdentity({ actingUserId, canonicalOwnerId });
      if (!actingUserId || !canonicalOwnerId) {
        throw new Error("Could not determine your workspace identity -- guidance can't start safely without it.");
      }
      const now = new Date().toISOString();
      const evaluatorResults = buildTodaysPrioritiesEvaluatorResults(WORKFLOW_DEFINITION, nextSummary.needsAttention, now);
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
      .then(({ summary: nextSummary }) => {
        setSummary(nextSummary);
        const now = new Date().toISOString();
        const evaluatorResults = buildTodaysPrioritiesEvaluatorResults(WORKFLOW_DEFINITION, nextSummary.needsAttention, now);
        setSession((current) => advanceGuidedWorkflowSession(current, WORKFLOW_DEFINITION, evaluatorResults, identity.canonicalOwnerId, now));
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [session, identity]);

  // Pure navigation, re-derived from the last fetched summary rather than a fresh fetch -- Back is for
  // reviewing what's already been shown, not for re-confirming authoritative state (Next does that).
  const back = useCallback(() => {
    if (!session || !identity || !summary) return;
    setError("");
    const now = new Date().toISOString();
    const evaluatorResults = buildTodaysPrioritiesEvaluatorResults(WORKFLOW_DEFINITION, summary.needsAttention, now);
    setSession((current) => goBackGuidedWorkflowSession(current, WORKFLOW_DEFINITION, evaluatorResults, identity.canonicalOwnerId, now));
  }, [session, identity, summary]);

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

  return {
    workflowDefinition: WORKFLOW_DEFINITION,
    summary,
    session,
    currentStep,
    currentAttentionItem,
    loading,
    error,
    canGoBack,
    next,
    back,
    pause,
    resume,
    exit,
    restart,
  };
}
