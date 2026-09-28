"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildRentalDashboardSummary } from "@/application/rental/buildRentalDashboardSummary";
import { getRentalSummaryPayload } from "../rentalSummaryClient";
import { useRentalDashboardPayload } from "../useRentalDashboardPayload";
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

// Fetches the same live data source the Overview panel uses, through the shared client:
// the mount-time call dedups with the Overview's own fetch into one network pair (with
// network-blip retries), and { refresh: true } forces a fresh pair for paths that must
// re-evaluate against current authoritative state. Computes the real summary and evaluates
// the workflow's fixed step vocabulary against it. Never fabricates a required step that
// isn't actually present in the fetched needsAttention array.
//
// /api/rental/reports stays soft, exactly as before: only 2 of the 9 needsAttention categories
// depend on it, so its failure is reported as { available: false, error } and the other
// categories keep working rather than failing the entire session over an unrelated endpoint.
function processPayload({ rentalBody, reports }) {
  return {
    summary: buildRentalDashboardSummary(rentalBody, reports.report),
    actingUserId: rentalBody.actingUserId || null,
    canonicalOwnerId: rentalBody.canonicalOwnerId || null,
    reportsAvailable: reports.available,
    reportsError: reports.error,
  };
}

function fetchSummaryAndIdentity({ refresh = false } = {}) {
  return getRentalSummaryPayload({ refresh }).then(processPayload);
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
  // Init epoch: the mount effect may only initialize the session from the cache
  // at epoch 0. Every authoritative init (restart, and the identity-change
  // reinit below) bumps the epoch first, which permanently fences the mount
  // effect out -- a late cache update can never initialize a second session
  // from stale data while an authoritative fetch is in flight or completed.
  const initEpochRef = useRef(0);
  // Mount-time data comes through the shared SWR cache (same key the Overview panel
  // uses), so a reload hydrates instantly from the localStorage disk cache instead of
  // flashing "Loading...". User-triggered refreshes still fetch authoritative state
  // directly: next/retryReports via fetchSummaryAndIdentity({ refresh: true }), and
  // restart through runInitialize() below.
  const { data: cachedPayload, error: cachedError, isLoading: cacheLoading, identityEpoch } = useRentalDashboardPayload();

  const applyProcessedPayload = useCallback((processed, epoch) => {
    // Fenced out: a newer init superseded this one (restart or identity change
    // while this fetch was in flight). Never apply stale results over them.
    if (epoch !== initEpochRef.current) return;
    const { summary: nextSummary, actingUserId, canonicalOwnerId, reportsAvailable: nextReportsAvailable, reportsError: nextReportsError } = processed;
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
  }, []);

  // Authoritative init: always bumps the init epoch first, so the mount effect
  // can never initialize from cache afterwards, and any older in-flight init's
  // completion is fenced out by the epoch check in applyProcessedPayload.
  // The mount effect never calls this (it initializes from the cache at epoch
  // 0); `restart` and the identity watcher are the only callers. The watcher
  // passes { refresh: true }: the client's in-flight slot is not identity-aware,
  // so a switch mid-fetch would otherwise hand the old account's pair to the
  // new session -- refresh bypasses the slot and fetches under the new identity.
  const runInitialize = useCallback(({ refresh = false } = {}) => {
    const epoch = ++initEpochRef.current;
    setLoading(true);
    setError("");
    return fetchSummaryAndIdentity({ refresh })
      .then((processed) => { applyProcessedPayload(processed, epoch); })
      .catch((reason) => { if (epoch === initEpochRef.current) setError(reason.message); })
      .finally(() => { if (epoch === initEpochRef.current) setLoading(false); });
  }, [applyProcessedPayload]);

  // Mount: initialize from the shared cached payload once it arrives. A first-ever
  // load (empty disk cache) waits for the SWR fetch exactly like the old direct
  // fetch; a reload hydrates synchronously with no loading flash. Fenced to epoch
  // 0: once any authoritative init begins, this effect never initializes from
  // cache again -- a late cache update during restart() can't start a second
  // session from stale data and race the authoritative fetch.
  // The body runs async so the effect itself never calls setState synchronously
  // (lint rule), matching the old runInitialize discipline.
  useEffect(() => {
    if (initEpochRef.current !== 0 || cacheLoading) return;
    const epoch = initEpochRef.current;
    (async () => {
      if (epoch !== initEpochRef.current) return;
      if (!cachedPayload) {
        if (cachedError) setError(cachedError);
        setLoading(false);
        return;
      }
      try {
        applyProcessedPayload(processPayload(cachedPayload), epoch);
      } catch (reason) {
        if (epoch === initEpochRef.current) setError(reason.message);
      } finally {
        if (epoch === initEpochRef.current) setLoading(false);
      }
    })();
  }, [cachedPayload, cachedError, cacheLoading, applyProcessedPayload]);

  // Account switching: setCacheIdentity() wipes the shared cache and the SWR
  // hook refetches for the new identity, but without this the session would
  // keep showing the previous identity's summary. On an epoch change, drop the
  // old session and reinitialize authoritatively -- the cached payload belongs
  // to the previous identity and must never initialize the new session.
  const identityEpochRef = useRef(identityEpoch);
  useEffect(() => {
    if (identityEpochRef.current === identityEpoch) return;
    identityEpochRef.current = identityEpoch;
    runInitialize({ refresh: true });
  }, [identityEpoch, runInitialize]);

  const restart = useCallback(() => runInitialize(), [runInitialize]);

  // Re-fetches real data before advancing, so "next" is always evaluated against current
  // authoritative state -- never against a stale in-memory guess of what's still required.
  const next = useCallback(() => {
    if (!session || !identity) return Promise.resolve();
    setLoading(true);
    setError("");
    return fetchSummaryAndIdentity({ refresh: true })
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
    return fetchSummaryAndIdentity({ refresh: true })
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
