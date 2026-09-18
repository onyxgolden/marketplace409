import{describe,expect,it,vi}from"vitest";import{renderToStaticMarkup}from"react-dom/server";import TenantLeaseSigningPanel from"./TenantLeaseSigningPanel.jsx";
const leaseSigning={preparationId:"prep_1",versionNumber:1,approvedAt:"2026-09-01T00:00:00Z",
  terms:{monthlyRent:"1500",propertyAddress:"123 Main St"},changeSummary:"Initial terms",
  signedByMe:false,mySignedAt:null,totalTenants:2,signatures:[]};
describe("TenantLeaseSigningPanel",()=>{
  it("renders nothing when no rental has a lease awaiting signing",()=>{
    const html=renderToStaticMarkup(<TenantLeaseSigningPanel rentals={[{lease:{id:"lease_1"},unit:null,leaseSigning:null}]} onSigned={vi.fn()}/>);
    expect(html).toBe("");
  });
  it("shows the approved terms and a signing form when the tenant has not yet signed",()=>{
    const html=renderToStaticMarkup(<TenantLeaseSigningPanel rentals={[{lease:{id:"lease_1",startDate:"2026-10-01",endDate:null},unit:{label:"1214 Wagner"},leaseSigning}]} onSigned={vi.fn()}/>);
    expect(html).toContain("1214 Wagner");
    expect(html).toContain("1500");
    expect(html).toContain("Type your full legal name");
    expect(html).toContain("Sign lease");
  });
  it("shows the signed confirmation and hides the signing form once this tenant has signed",()=>{
    const signed={...leaseSigning,signedByMe:true,mySignedAt:"2026-09-05T10:00:00Z",
      signatures:[{tenantId:"tenant_1",signerName:"Jane Tenant",signedAt:"2026-09-05T10:00:00Z",displayName:"Jane Tenant"}]};
    const html=renderToStaticMarkup(<TenantLeaseSigningPanel rentals={[{lease:{id:"lease_1",startDate:"2026-10-01",endDate:null},unit:{label:"1214 Wagner"},leaseSigning:signed}]} onSigned={vi.fn()}/>);
    expect(html).toContain("You signed");
    expect(html).not.toContain("Type your full legal name");
  });
});
