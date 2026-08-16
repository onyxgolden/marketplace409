export function buildRentersInsuranceComplianceReport({units=[],tenants=[],leases=[],memberships=[],evidence=[]},{propertyId=""}={}){
  const unitById=new Map(units.map(item=>[item.id,item]));const tenantById=new Map(tenants.map(item=>[item.id,item]));
  const tenantIdsByLease=new Map();for(const membership of memberships){const list=tenantIdsByLease.get(membership.lease_id)||[];list.push(membership.tenant_id);tenantIdsByLease.set(membership.lease_id,list);}
  const evidenceByLease=new Map();for(const item of evidence){const list=evidenceByLease.get(item.lease_id)||[];list.push(item);evidenceByLease.set(item.lease_id,list);}
  const allRows=leases.filter(lease=>lease.status==="active").map(lease=>{
    const leaseEvidence=(evidenceByLease.get(lease.id)||[]).slice().sort((a,b)=>a.created_at<b.created_at?1:-1);
    const tenantIds=tenantIdsByLease.get(lease.id)||[];
    return Object.freeze({leaseId:lease.id,propertyId:lease.property_id,unitLabel:unitById.get(lease.unit_id)?.label||lease.unit_id,
      tenantNames:Object.freeze(tenantIds.map(id=>tenantById.get(id)?.display_name||id)),
      hasEvidence:leaseEvidence.length>0,evidenceCount:leaseEvidence.length,mostRecentUploadAt:leaseEvidence[0]?.created_at||null});
  }).sort((a,b)=>Number(a.hasEvidence)-Number(b.hasEvidence)||a.unitLabel.localeCompare(b.unitLabel));
  const availableProperties=Object.freeze([...new Set(allRows.map(row=>row.propertyId))].filter(Boolean).sort());
  const rows=propertyId?allRows.filter(row=>row.propertyId===propertyId):allRows;
  return Object.freeze({generatedAt:new Date().toISOString(),propertyId:propertyId||null,availableProperties,
    summary:Object.freeze({activeLeaseCount:rows.length,compliantCount:rows.filter(row=>row.hasEvidence).length,missingCount:rows.filter(row=>!row.hasEvidence).length}),
    rows:Object.freeze(rows)});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function rentersInsuranceComplianceReportToCsv(report){const lines=[["Lease ID","Property ID","Unit","Tenants","Has evidence on file","Evidence count","Most recent upload"]];
for(const row of report.rows)lines.push([row.leaseId,row.propertyId,row.unitLabel,row.tenantNames.join("; "),row.hasEvidence?"Yes":"No",row.evidenceCount,row.mostRecentUploadAt||""]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
