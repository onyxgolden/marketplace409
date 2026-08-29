"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildFirstTenantReadinessWorkflowDefinition,
  buildFirstTenantReadinessEvaluatorResults,
  selectVacantUnitsForReadiness,
  createSemanticTargetRegistry,
  startGuidedWorkflowSession,
  advanceGuidedWorkflowSession,
  goBackGuidedWorkflowSession,
  pauseGuidedWorkflowSession,
  resumeGuidedWorkflowSession,
  exitGuidedWorkflowSession,
  sessionHasUnavailableSteps,
} from "@/domains/guided-workflow";
import { FIRST_TENANT_READINESS_EXPLANATIONS } from "./firstTenantReadinessExplanations";

const WORKFLOW_DEFINITION = buildFirstTenantReadinessWorkflowDefinition(FIRST_TENANT_READINESS_EXPLANATIONS);
export const FIRST_TENANT_READINESS_SEMANTIC_TARGET_REGISTRY = createSemanticTargetRegistry(
  WORKFLOW_DEFINITION.steps.map((step) => ({ targetId: step.semanticTargetId, description: step.instruction })),
);

function generateSessionId(unitId) {
  return `rental-first-tenant-readiness-${unitId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function fetchRentalData() {
  return fetch("/api/rental").then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Rental data could not be loaded.");
    return body;
  });
}

export function useFirstTenantReadinessSession() {
  const [rentalData, setRentalData] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [unitId, setUnitId] = useState(null);
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

  // Reuses buildRentalDashboardSummary.js's own "no active lease references this unit" predicate
  // (via selectVacantUnitsForReadiness) so this workflow's unit picker can never disagree with Today's
  // Priorities' own vacancy count about which units are actually vacant.
  const vacantUnits = useMemo(() => (rentalData ? selectVacantUnitsForReadiness(rentalData) : []), [rentalData]);

  const selectUnit = useCallback((nextUnitId) => {
    if (!rentalData || !identity || !identity.actingUserId || !identity.canonicalOwnerId) return;
    setError("");
    sessionIdRef.current = generateSessionId(nextUnitId);
    const now = new Date().toISOString();
    const evaluatorResults = buildFirstTenantReadinessEvaluatorResults(WORKFLOW_DEFINITION, rentalData, nextUnitId, now);
    setUnitId(nextUnitId);
    setSession(startGuidedWorkflowSession({
      sessionId: sessionIdRef.current,
      workflowDefinition: WORKFLOW_DEFINITION,
      evaluatorResults,
      actingUserId: identity.actingUserId,
      canonicalOwnerId: identity.canonicalOwnerId,
      now,
    }));
  }, [rentalData, identity]);

  // Returns to the unit picker rather than trying to resume mid-session -- a landlord who exits or hits
  // an error is choosing (or re-choosing) which unit to prepare, exactly like arriving fresh.
  const changeUnit = useCallback(() => {
    setUnitId(null);
    setSession(null);
    setError("");
  }, []);

  const restart = useCallback(() => {
    setLoading(true);
    setError("");
    setUnitId(null);
    setSession(null);
    return loadPortfolio();
  }, [loadPortfolio]);

  // Re-fetches real portfolio data before advancing, so "next" is always evaluated against current
  // authoritative state for this unit -- never against a stale in-memory guess.
  const next = useCallback(() => {
    if (!session || !identity || !unitId) return Promise.resolve();
    setLoading(true);
    setError("");
    return fetchRentalData()
      .then((body) => {
        setRentalData(body);
        const now = new Date().toISOString();
        const evaluatorResults = buildFirstTenantReadinessEvaluatorResults(WORKFLOW_DEFINITION, body, unitId, now);
        setSession((current) => advanceGuidedWorkflowSession(current, WORKFLOW_DEFINITION, evaluatorResults, identity.canonicalOwnerId, now));
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [session, identity, unitId]);

  // Pure navigation, re-derived from the last fetched data rather than a fresh fetch -- Back is for
  // reviewing what's already been shown, not for re-confirming authoritative state (Next does that).
  const back = useCallback(() => {
    if (!session || !identity || !rentalData || !unitId) return;
    setError("");
    const now = new Date().toISOString();
    const evaluatorResults = buildFirstTenantReadinessEvaluatorResults(WORKFLOW_DEFINITION, rentalData, unitId, now);
    setSession((current) => goBackGuidedWorkflowSession(current, WORKFLOW_DEFINITION, evaluatorResults, identity.canonicalOwnerId, now));
  }, [session, identity, rentalData, unitId]);

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
    if (!currentStep || !rentalData || !unitId) return null;
    const now = new Date().toISOString();
    const results = buildFirstTenantReadinessEvaluatorResults(WORKFLOW_DEFINITION, rentalData, unitId, now);
    return results.find((result) => result.stepId === currentStep.stepId) || null;
  }, [currentStep, rentalData, unitId]);

  const canGoBack = useMemo(() => {
    if (!currentStep || !rentalData || !unitId) return false;
    const now = new Date().toISOString();
    const results = buildFirstTenantReadinessEvaluatorResults(WORKFLOW_DEFINITION, rentalData, unitId, now);
    const byId = new Map(results.map((result) => [result.stepId, result]));
    const currentIndex = WORKFLOW_DEFINITION.steps.findIndex((step) => step.stepId === currentStep.stepId);
    return WORKFLOW_DEFINITION.steps.slice(0, currentIndex).some((step) => {
      const result = byId.get(step.stepId);
      return result && ["required", "requires_confirmation", "blocked"].includes(result.status);
    });
  }, [currentStep, rentalData, unitId]);

  const hasUnavailableSteps = useMemo(() => (session ? sessionHasUnavailableSteps(session) : false), [session]);

  const selectedUnit = useMemo(() => (rentalData && unitId ? (rentalData.units || []).find((unit) => unit.id === unitId) || null : null), [rentalData, unitId]);

  return {
    workflowDefinition: WORKFLOW_DEFINITION,
    vacantUnits,
    unitId,
    selectedUnit,
    session,
    currentStep,
    currentStepResult,
    loading,
    error,
    canGoBack,
    hasUnavailableSteps,
    selectUnit,
    changeUnit,
    next,
    back,
    pause,
    resume,
    exit,
    restart,
  };
}
