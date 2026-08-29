"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildLeaseRenewalWorkflowDefinition,
  buildLeaseRenewalEvaluatorResults,
  selectLeasesExpiringSoonForRenewal,
  createSemanticTargetRegistry,
  startGuidedWorkflowSession,
  advanceGuidedWorkflowSession,
  goBackGuidedWorkflowSession,
  pauseGuidedWorkflowSession,
  resumeGuidedWorkflowSession,
  exitGuidedWorkflowSession,
  sessionHasUnavailableSteps,
} from "@/domains/guided-workflow";
import { LEASE_RENEWAL_EXPLANATIONS } from "./leaseRenewalExplanations";

const WORKFLOW_DEFINITION = buildLeaseRenewalWorkflowDefinition(LEASE_RENEWAL_EXPLANATIONS);
export const LEASE_RENEWAL_SEMANTIC_TARGET_REGISTRY = createSemanticTargetRegistry(
  WORKFLOW_DEFINITION.steps.map((step) => ({ targetId: step.semanticTargetId, description: step.instruction })),
);

function generateSessionId(leaseId) {
  return `rental-lease-renewal-${leaseId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function fetchRentalData() {
  return fetch("/api/rental").then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Rental data could not be loaded.");
    return body;
  });
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

export function useLeaseRenewalSession() {
  const [rentalData, setRentalData] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [leaseId, setLeaseId] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sessionIdRef = useRef(null);

  // No synchronous setState here -- every state update happens inside the fetch's then/catch/finally
  // callbacks, which run asynchronously. This lets the mount effect below call it directly without
  // triggering cascading synchronous renders from within an effect body.
  const loadPortfolio = useCallback(() => fetchRentalData()
    .then((body) => {
      if (!body.actingUserId || !body.canonicalOwnerId) {
        throw new Error("Could not determine your workspace identity -- guidance can't start safely without it.");
      }
      setRentalData(body);
      setIdentity({ actingUserId: body.actingUserId, canonicalOwnerId: body.canonicalOwnerId });
    })
    .catch((reason) => setError(reason.message))
    .finally(() => setLoading(false)), []);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  // Reuses buildRentalDashboardSummary.js's own 30-day "expiring soon" predicate (via
  // selectLeasesExpiringSoonForRenewal) so this workflow's lease picker can never disagree with
  // Today's Priorities' own leases-expiring-soon count about which leases actually qualify.
  const expiringLeases = useMemo(
    () => (rentalData ? selectLeasesExpiringSoonForRenewal(rentalData, todayISODate()) : []),
    [rentalData],
  );

  const selectLease = useCallback((nextLeaseId) => {
    if (!rentalData || !identity || !identity.actingUserId || !identity.canonicalOwnerId) return;
    setError("");
    sessionIdRef.current = generateSessionId(nextLeaseId);
    const now = new Date().toISOString();
    const evaluatorResults = buildLeaseRenewalEvaluatorResults(WORKFLOW_DEFINITION, rentalData, nextLeaseId, now);
    setLeaseId(nextLeaseId);
    setSession(startGuidedWorkflowSession({
      sessionId: sessionIdRef.current,
      workflowDefinition: WORKFLOW_DEFINITION,
      evaluatorResults,
      actingUserId: identity.actingUserId,
      canonicalOwnerId: identity.canonicalOwnerId,
      now,
    }));
  }, [rentalData, identity]);

  // Returns to the lease picker rather than trying to resume mid-session -- a landlord who exits or
  // hits an error is choosing (or re-choosing) which lease to renew, exactly like arriving fresh.
  const changeLease = useCallback(() => {
    setLeaseId(null);
    setSession(null);
    setError("");
  }, []);

  const restart = useCallback(() => {
    setLoading(true);
    setError("");
    setLeaseId(null);
    setSession(null);
    return loadPortfolio();
  }, [loadPortfolio]);

  // Re-fetches real portfolio data before advancing, so "next" is always evaluated against current
  // authoritative state for this lease -- never against a stale in-memory guess.
  const next = useCallback(() => {
    if (!session || !identity || !leaseId) return Promise.resolve();
    setLoading(true);
    setError("");
    return fetchRentalData()
      .then((body) => {
        setRentalData(body);
        const now = new Date().toISOString();
        const evaluatorResults = buildLeaseRenewalEvaluatorResults(WORKFLOW_DEFINITION, body, leaseId, now);
        setSession((current) => advanceGuidedWorkflowSession(current, WORKFLOW_DEFINITION, evaluatorResults, identity.canonicalOwnerId, now));
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [session, identity, leaseId]);

  // Pure navigation, re-derived from the last fetched data rather than a fresh fetch -- Back is for
  // reviewing what's already been shown, not for re-confirming authoritative state (Next does that).
  const back = useCallback(() => {
    if (!session || !identity || !rentalData || !leaseId) return;
    setError("");
    const now = new Date().toISOString();
    const evaluatorResults = buildLeaseRenewalEvaluatorResults(WORKFLOW_DEFINITION, rentalData, leaseId, now);
    setSession((current) => goBackGuidedWorkflowSession(current, WORKFLOW_DEFINITION, evaluatorResults, identity.canonicalOwnerId, now));
  }, [session, identity, rentalData, leaseId]);

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

  const currentStepResult = useMemo(() => {
    if (!currentStep || !rentalData || !leaseId) return null;
    const now = new Date().toISOString();
    const results = buildLeaseRenewalEvaluatorResults(WORKFLOW_DEFINITION, rentalData, leaseId, now);
    return results.find((result) => result.stepId === currentStep.stepId) || null;
  }, [currentStep, rentalData, leaseId]);

  const canGoBack = useMemo(() => {
    if (!currentStep || !rentalData || !leaseId) return false;
    const now = new Date().toISOString();
    const results = buildLeaseRenewalEvaluatorResults(WORKFLOW_DEFINITION, rentalData, leaseId, now);
    const byId = new Map(results.map((result) => [result.stepId, result]));
    const currentIndex = WORKFLOW_DEFINITION.steps.findIndex((step) => step.stepId === currentStep.stepId);
    return WORKFLOW_DEFINITION.steps.slice(0, currentIndex).some((step) => {
      const result = byId.get(step.stepId);
      return result && ["required", "requires_confirmation", "blocked"].includes(result.status);
    });
  }, [currentStep, rentalData, leaseId]);

  const hasUnavailableSteps = useMemo(() => (session ? sessionHasUnavailableSteps(session) : false), [session]);

  const selectedLease = useMemo(
    () => (rentalData && leaseId ? (rentalData.leases || []).find((lease) => lease.id === leaseId) || null : null),
    [rentalData, leaseId],
  );

  return {
    workflowDefinition: WORKFLOW_DEFINITION,
    expiringLeases,
    leaseId,
    selectedLease,
    rentalData,
    session,
    currentStep,
    currentStepResult,
    loading,
    error,
    canGoBack,
    hasUnavailableSteps,
    selectLease,
    changeLease,
    next,
    back,
    pause,
    resume,
    exit,
    restart,
  };
}
