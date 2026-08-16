const OPEN_STATUSES=new Set(["draft","assigned","scheduled","in_progress"]);
export function buildWorkOrdersReport({units=[],requests=[],workOrders=[],contractors=[]},{propertyId=""}={}){
  const unitById=new Map(units.map(item=>[item.id,item]));const requestById=new Map(requests.map(item=>[item.id,item]));
  const contractorById=new Map(contractors.map(item=>[item.id,item]));
  const allRows=workOrders.map(order=>{
    const request=requestById.get(order.request_id);const unit=unitById.get(request?.unit_id);
    return Object.freeze({workOrderId:order.id,propertyId:unit?.property_id||"",unitLabel:unit?.label||request?.unit_id||"",
      contractorName:contractorById.get(order.contractor_id)?.business_name||"Unassigned",status:order.status,isOpen:OPEN_STATUSES.has(order.status),
      scopeOfWork:order.scope_of_work,scheduledStart:order.scheduled_start||"",scheduledEnd:order.scheduled_end||"",
      estimatedCostCents:order.estimated_cost_cents!=null?Number(order.estimated_cost_cents):null,
      actualCostCents:order.actual_cost_cents!=null?Number(order.actual_cost_cents):null,completedAt:order.completed_at||""});
  }).sort((a,b)=>Number(b.isOpen)-Number(a.isOpen)||(b.scheduledStart||"").localeCompare(a.scheduledStart||""));
  const availableProperties=Object.freeze([...new Set(allRows.map(row=>row.propertyId))].filter(Boolean).sort());
  const rows=propertyId?allRows.filter(row=>row.propertyId===propertyId):allRows;
  return Object.freeze({generatedAt:new Date().toISOString(),propertyId:propertyId||null,availableProperties,
    summary:Object.freeze({openCount:rows.filter(row=>row.isOpen).length,closedCount:rows.filter(row=>!row.isOpen).length,
      totalEstimatedCents:rows.reduce((sum,row)=>sum+(row.estimatedCostCents||0),0),totalActualCents:rows.reduce((sum,row)=>sum+(row.actualCostCents||0),0)}),
    rows:Object.freeze(rows)});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;const money=(cents)=>cents==null?"":(cents/100).toFixed(2);
export function workOrdersReportToCsv(report){const lines=[["Work order ID","Property ID","Unit","Contractor","Status","Scope of work","Scheduled start","Scheduled end","Estimated cost","Actual cost","Completed at"]];
for(const row of report.rows)lines.push([row.workOrderId,row.propertyId,row.unitLabel,row.contractorName,row.status,row.scopeOfWork,row.scheduledStart,row.scheduledEnd,money(row.estimatedCostCents),money(row.actualCostCents),row.completedAt]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
