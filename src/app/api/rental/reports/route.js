import{NextResponse}from"next/server";import{createAuthenticatedForgeApplication}from"@/lib/supabase/createAuthenticatedForgeApplication";import{buildRentalOperatingReport,rentalReportToCsv}from"@/application/rental/buildRentalOperatingReport";import{buildRentalTaxPackage,rentalTaxPackageToCsv}from"@/application/rental/buildRentalTaxPackage";import{buildDelinquentTenantsReport,delinquentTenantsReportToCsv}from"@/application/rental/buildDelinquentTenantsReport";import{buildLeaseExpirationReport,leaseExpirationReportToCsv}from"@/application/rental/buildLeaseExpirationReport";import{buildVacantUnitsReport,vacantUnitsReportToCsv}from"@/application/rental/buildVacantUnitsReport";import{buildTenantContactListReport,tenantContactListReportToCsv}from"@/application/rental/buildTenantContactListReport";import{buildUpcomingChargesReport,upcomingChargesReportToCsv}from"@/application/rental/buildUpcomingChargesReport";import{buildFinancialLedgerReport,financialLedgerReportToCsv}from"@/application/financial/buildFinancialLedgerReport";import{scopeRentalDataToProperty}from"@/application/rental/scopeRentalDataToProperty";
const REPORT_BUILDERS={
  "":{build:(data,url)=>buildRentalOperatingReport(data,url.searchParams.get("asOfDate")||undefined),toCsv:rentalReportToCsv,filename:"rent-roll"},
  "delinquent-tenants":{build:(data,url)=>buildDelinquentTenantsReport(data,url.searchParams.get("asOfDate")||undefined),toCsv:delinquentTenantsReportToCsv,filename:"delinquent-tenants"},
  "lease-expiration":{build:(data,url)=>buildLeaseExpirationReport(data,{startDate:url.searchParams.get("startDate")||undefined,endDate:url.searchParams.get("endDate")||undefined}),toCsv:leaseExpirationReportToCsv,filename:"lease-expiration"},
  "vacant-units":{build:(data,url)=>buildVacantUnitsReport(data,url.searchParams.get("asOfDate")||undefined),toCsv:vacantUnitsReportToCsv,filename:"vacant-units"},
  "tenant-contacts":{build:(data)=>buildTenantContactListReport(data),toCsv:tenantContactListReportToCsv,filename:"tenant-contacts"},
  "upcoming-charges":{build:(data,url)=>buildUpcomingChargesReport(data,{startDate:url.searchParams.get("startDate")||undefined,endDate:url.searchParams.get("endDate")||undefined}),toCsv:upcomingChargesReportToCsv,filename:"upcoming-charges"},
};
export async function GET(request){
  try{
    const a=await createAuthenticatedForgeApplication();if(a.response)return a.response;
    const url=new URL(request.url);
    if(url.searchParams.get("format")==="tax-csv"){
      const taxYear=Number(url.searchParams.get("taxYear"));
      if(!Number.isInteger(taxYear)||taxYear<2000||taxYear>2100)return NextResponse.json({error:"A valid tax year is required."},{status:400});
      const names=["rental_contractors","rental_contractor_payments","rental_1099_reviews"],values=await Promise.all(names.map(name=>a.supabaseClient.from(name).select("*"))),error=values.find(v=>v.error)?.error;
      if(error)throw error;
      const report=buildRentalTaxPackage({contractors:values[0].data||[],contractorPayments:values[1].data||[],reviews:values[2].data||[]},taxYear,url.searchParams.get("propertyId")||"");
      return new Response(rentalTaxPackageToCsv(report),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="forge-rental-contractor-tax-${taxYear}.csv"`}});
    }
    const reportKey=url.searchParams.get("report")||"";
    if(reportKey==="account-ledger"){
      const{data:eventRows,error:eventError}=await a.supabaseClient.from("financial_events").select("id,event_date,description,amount,transaction_kind,normalized_category,property_id,status,is_deleted");
      if(eventError)throw eventError;
      const report=buildFinancialLedgerReport({events:eventRows||[]},{propertyId:url.searchParams.get("propertyId")||"",startDate:url.searchParams.get("startDate")||"",endDate:url.searchParams.get("endDate")||""});
      if(url.searchParams.get("format")==="csv")return new Response(financialLedgerReportToCsv(report),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="forge-account-ledger-${report.generatedAt.slice(0,10)}.csv"`}});
      return NextResponse.json({success:true,report});
    }
    const builder=REPORT_BUILDERS[reportKey];
    if(!builder)return NextResponse.json({error:"Unknown report."},{status:400});
    const tables=["rental_units","rental_tenants","rental_leases","rental_lease_tenants","rent_charges","rental_payments"],results=await Promise.all(tables.map(table=>a.supabaseClient.from(table).select("*"))),error=results.find(item=>item.error)?.error;
    if(error)throw error;
    const data=Object.fromEntries(tables.map((table,index)=>[({rental_units:"units",rental_tenants:"tenants",rental_leases:"leases",rental_lease_tenants:"memberships",rent_charges:"charges",rental_payments:"payments"})[table],results[index].data||[]]));
    const availableProperties=Object.freeze([...new Set(data.units.map(unit=>unit.property_id))].filter(Boolean).sort());
    const scopedData=scopeRentalDataToProperty(data,url.searchParams.get("propertyId")||"");
    const report=builder.build(scopedData,url);
    if(url.searchParams.get("format")==="csv")return new Response(builder.toCsv(report),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="forge-rental-${builder.filename}-${report.asOfDate||report.startDate||report.generatedAt.slice(0,10)}.csv"`}});
    return NextResponse.json({success:true,report:{...report,availableProperties}});
  }catch(error){
    console.error("Rental report error",error);
    return NextResponse.json({error:"Unable to build rental reports."},{status:500});
  }
}
