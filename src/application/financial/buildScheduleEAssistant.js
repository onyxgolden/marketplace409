const LINE_MAP={
  rental_income:{line:"3",label:"Rents received"},cam_income:{line:"3",label:"Rents received"},
  advertising:{line:"5",label:"Advertising"},
  auto:{line:"6",label:"Auto and travel"},travel:{line:"6",label:"Auto and travel"},
  cleaning:{line:"7",label:"Cleaning and maintenance"},maintenance:{line:"7",label:"Cleaning and maintenance"},
  commissions:{line:"8",label:"Commissions"},
  insurance:{line:"9",label:"Insurance"},
  legal:{line:"10",label:"Legal and professional fees"},legal_and_professional_fees:{line:"10",label:"Legal and professional fees"},professional_fees:{line:"10",label:"Legal and professional fees"},
  management_fees:{line:"11",label:"Management fees"},
  mortgage_interest:{line:"12",label:"Mortgage interest paid to banks"},
  other_interest:{line:"13",label:"Other interest"},
  property_repairs:{line:"14",label:"Repairs"},repairs:{line:"14",label:"Repairs"},
  supplies:{line:"15",label:"Supplies"},tools:{line:"15",label:"Supplies"},
  property_tax:{line:"16",label:"Taxes"},taxes:{line:"16",label:"Taxes"},
  utilities:{line:"17",label:"Utilities"},
};
export function buildScheduleEAssistant({events=[]},{taxYear,propertyId=""}={}){
  const year=Number(taxYear);
  const scoped=events.filter(event=>event.status!=="inactive"&&event.status!=="deleted"&&event.is_deleted!==true&&event.transaction_kind!=="asset_purchase"
    &&Number(String(event.event_date).slice(0,4))===year&&(!propertyId||(event.property_id||"unassigned")===propertyId));
  const lineTotals=new Map();
  for(const event of scoped){
    const mapping=LINE_MAP[event.normalized_category]||{line:"19",label:"Other"};
    const key=`${mapping.line}|${mapping.label}`;
    if(!lineTotals.has(key))lineTotals.set(key,{line:mapping.line,label:mapping.label,amountCents:0,transactionCount:0,categories:new Set()});
    const entry=lineTotals.get(key);
    const signedCents=event.transaction_kind==="income"?Math.abs(Number(event.amount)):-Math.abs(Number(event.amount));
    entry.amountCents+=signedCents;entry.transactionCount+=1;entry.categories.add(event.normalized_category||"other");
  }
  const lines=Object.freeze([...lineTotals.values()].map(entry=>Object.freeze({line:entry.line,label:entry.label,amountCents:entry.amountCents,
    transactionCount:entry.transactionCount,categories:Object.freeze([...entry.categories].sort())}))
    .sort((a,b)=>Number(a.line)-Number(b.line)));
  const totalRents=lines.filter(l=>l.line==="3").reduce((sum,l)=>sum+l.amountCents,0);
  const totalExpenses=lines.filter(l=>l.line!=="3").reduce((sum,l)=>sum-l.amountCents,0);
  return Object.freeze({generatedAt:new Date().toISOString(),taxYear:year,propertyId:propertyId||null,
    summary:Object.freeze({totalRentsReceivedCents:totalRents,totalExpensesCents:totalExpenses,netIncomeCents:totalRents-totalExpenses,depreciationTracked:false}),
    lines});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function scheduleEAssistantToCsv(report){const lines=[["Schedule E line","Label","Amount","Transaction count","Source categories"]];
for(const row of report.lines)lines.push([row.line,row.label,(row.amountCents/100).toFixed(2),row.transactionCount,row.categories.join("; ")]);
lines.push(["18","Depreciation (not tracked — add manually with your accountant)","","",""]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
