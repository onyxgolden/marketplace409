const HELD_SIGNS={received:1,adjustment_increase:1,deduction:-1,refunded:-1,adjustment_decrease:-1};
export function buildSecurityDepositsReport({units=[],tenants=[],leases=[],memberships=[],deposits=[],transactions=[]},{propertyId=""}={}){
  const unitById=new Map(units.map(item=>[item.id,item]));const leaseById=new Map(leases.map(item=>[item.id,item]));
  const tenantIdsByLease=new Map();for(const membership of memberships){const list=tenantIdsByLease.get(membership.lease_id)||[];list.push(membership.tenant_id);tenantIdsByLease.set(membership.lease_id,list);}
  const tenantById=new Map(tenants.map(item=>[item.id,item]));
  const transactionsByDeposit=new Map();for(const transaction of transactions){const list=transactionsByDeposit.get(transaction.deposit_id)||[];list.push(transaction);transactionsByDeposit.set(transaction.deposit_id,list);}
  const allRows=deposits.map(deposit=>{
    const depositTransactions=transactionsByDeposit.get(deposit.id)||[];
    const heldCents=depositTransactions.reduce((sum,item)=>sum+(HELD_SIGNS[item.transaction_type]||0)*Number(item.amount_cents),0);
    const lease=leaseById.get(deposit.lease_id);const tenant=tenantById.get(deposit.tenant_id);
    const tenantIds=tenantIdsByLease.get(deposit.lease_id)||[];
    const tenantNames=tenantIds.length?tenantIds.map(id=>tenantById.get(id)?.display_name||id):(tenant?[tenant.display_name]:[]);
    return Object.freeze({depositId:deposit.id,leaseId:deposit.lease_id,propertyId:lease?.property_id||"",unitLabel:unitById.get(lease?.unit_id)?.label||lease?.unit_id||"",
      tenantNames:Object.freeze(tenantNames),status:deposit.status,requiredCents:Number(deposit.required_amount_cents),heldCents,
      jurisdictionCode:deposit.jurisdiction_code||"",dispositionDeadline:deposit.disposition_deadline||""});
  }).sort((a,b)=>a.unitLabel.localeCompare(b.unitLabel));
  const availableProperties=Object.freeze([...new Set(allRows.map(row=>row.propertyId))].filter(Boolean).sort());
  const rows=propertyId?allRows.filter(row=>row.propertyId===propertyId):allRows;
  return Object.freeze({generatedAt:new Date().toISOString(),propertyId:propertyId||null,availableProperties,
    summary:Object.freeze({depositCount:rows.length,totalRequiredCents:rows.reduce((sum,row)=>sum+row.requiredCents,0),totalHeldCents:rows.reduce((sum,row)=>sum+row.heldCents,0)}),
    rows:Object.freeze(rows)});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function securityDepositsReportToCsv(report){const lines=[["Deposit ID","Property ID","Unit","Tenants","Status","Required","Held","Jurisdiction","Disposition deadline"]];
for(const row of report.rows)lines.push([row.depositId,row.propertyId,row.unitLabel,row.tenantNames.join("; "),row.status,(row.requiredCents/100).toFixed(2),(row.heldCents/100).toFixed(2),row.jurisdictionCode,row.dispositionDeadline]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
