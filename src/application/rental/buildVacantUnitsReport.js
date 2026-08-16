const dayDiff=(fromStr,toStr)=>Math.round((new Date(`${toStr}T00:00:00Z`)-new Date(`${fromStr}T00:00:00Z`))/86400000);
export function buildVacantUnitsReport({units=[],leases=[]},today=new Date().toISOString().slice(0,10)){
  const occupiedUnitIds=new Set(leases.filter(lease=>lease.status==="active").map(lease=>lease.unit_id));
  const rows=units.filter(unit=>unit.status!=="inactive"&&!occupiedUnitIds.has(unit.id)).map(unit=>{
    const availableDate=unit.available_at?String(unit.available_at).slice(0,10):null;
    const daysVacant=availableDate&&availableDate<=today?dayDiff(availableDate,today):null;
    return Object.freeze({unitId:unit.id,propertyId:unit.property_id,unitLabel:unit.label,status:unit.status,
      bedrooms:unit.bedrooms??null,bathrooms:unit.bathrooms??null,squareFeet:unit.square_feet??null,availableAt:availableDate,daysVacant});
  }).sort((a,b)=>(b.daysVacant??-1)-(a.daysVacant??-1));
  return Object.freeze({generatedAt:new Date().toISOString(),asOfDate:today,
    summary:Object.freeze({vacantUnitCount:rows.length,totalUnitCount:units.length}),rows:Object.freeze(rows)});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function vacantUnitsReportToCsv(report){const lines=[["Unit ID","Property ID","Unit","Status","Bedrooms","Bathrooms","Square feet","Available since","Days vacant"]];
for(const row of report.rows)lines.push([row.unitId,row.propertyId,row.unitLabel,row.status,row.bedrooms,row.bathrooms,row.squareFeet,row.availableAt||"",row.daysVacant??""]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
