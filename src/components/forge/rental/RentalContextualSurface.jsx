"use client";
import { useCallback } from "react";
import { filterRentalRecordsByContext, rentalContextLeaseIds } from "./filterRentalRecordsByContext";
import RentalPaymentsPanel from "./RentalPaymentsPanel";import RentalMaintenancePanel from "./RentalMaintenancePanel";import RentalInspectionsPanel from "./RentalInspectionsPanel";import RentalDocumentsPanel from "./RentalDocumentsPanel";import RentalCommunicationsPanel from "./RentalCommunicationsPanel";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";
export function buildContextualRentalData(data, context) {const leaseIds=rentalContextLeaseIds(data,context),keep=records=>filterRentalRecordsByContext(records,data,context),leases=(data.leases||[]).filter(item=>leaseIds.has(item.id)),memberships=(data.leaseMemberships||[]).filter(item=>leaseIds.has(item.lease_id)),unitIds=new Set(leases.map(item=>item.unit_id)),tenantIds=new Set(memberships.map(item=>item.tenant_id));return{...data,units:(data.units||[]).filter(item=>context.recordType==="unit"?item.id===context.recordId:unitIds.has(item.id)),tenants:(data.tenants||[]).filter(item=>context.recordType==="tenant"?item.id===context.recordId:tenantIds.has(item.id)),leases,schedules:keep(data.schedules),openCharges:keep(data.openCharges),payments:keep(data.payments),maintenanceRequests:keep(data.maintenanceRequests),inspections:keep(data.inspections),notifications:keep(data.notifications),documents:keep(data.documents),leaseMemberships:memberships}}
export default function RentalContextualSurface({surfaceId,recordContext}){
  // Contextual record surface: stale-while-revalidate, keyed per surface + record.
  // The cached contextual dataset renders instantly when switching records and
  // refreshes in the background — the last good surface never blanks out.
  const recordType = recordContext?.recordType || "none", recordId = recordContext?.recordId || "none";
  const fetchContextual = useCallback(async () => {
    const responses = await Promise.all([fetch("/api/rental"),...(surfaceId==="documents"||surfaceId==="inspections"?[fetch("/api/rental/documents")]:[])]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    if (!responses[0].ok) throw new Error(bodies[0].error);
    if (responses[1] && !responses[1].ok) throw new Error(bodies[1].error);
    return buildContextualRentalData({ ...bodies[0], documents: bodies[1]?.documents || [] }, recordContext);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceId, recordType, recordId]);
  const cacheKey = `rental:contextual:${surfaceId}:${recordType}:${recordId}`;
  const { data, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    cacheKey,
    fetchContextual,
    { ttlMs: 60_000 },
  );
  if (!data && isLoading) return <ForgeLoadingState label={`Loading records for ${recordContext.recordLabel}…`} />;
  if (!data && loadError) return <ForgeErrorState title="Unable to load records" detail={loadError} onRetry={() => refresh()} />;
  // The converted children accept a scoped cacheKey so their mutation refresh()
  // revalidates this contextual dataset instead of the global key — scoped data
  // never pollutes the global caches. (Documents keeps its own pattern; it is
  // outside this slice.)
  const scopeData=value=>buildContextualRentalData(value,recordContext),surfaces={charges:<RentalPaymentsPanel initialData={data} dataScope={scopeData} cacheKey={cacheKey}/>,maintenance:<RentalMaintenancePanel initialData={data} dataScope={scopeData} cacheKey={cacheKey}/>,inspections:<RentalInspectionsPanel initialData={data} dataScope={scopeData} cacheKey={cacheKey}/>,documents:<RentalDocumentsPanel initialData={data} dataScope={scopeData} recordContext={recordContext}/>,communications:<RentalCommunicationsPanel initialData={data} dataScope={scopeData} cacheKey={cacheKey}/>};
  return <>{data && loadError ? <p role="status" className="mb-3 text-xs font-bold text-slate-400 dark:text-slate-500">Could not refresh — showing the last saved records.</p> : null}{data && isRefreshing ? <p className="mb-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p> : null}{surfaces[surfaceId]||null}</>;
}
