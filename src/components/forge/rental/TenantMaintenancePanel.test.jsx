import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TenantMaintenancePanel from "./TenantMaintenancePanel.jsx";

describe("TenantMaintenancePanel", () => {
  it("renders tenant intake controls for an active lease", () => {
    const markup = renderToStaticMarkup(<TenantMaintenancePanel rentals={[{ lease: { id: "lease_1", status: "active" },
      unit: { label: "Main residence" }, maintenanceRequests: [] }]} />);
    expect(markup).toContain("Report an issue");
    expect(markup).toContain("Landlord or approved vendor may enter");
    expect(markup).toContain("Submit maintenance request");
    expect(markup).toContain("call 911");
  });
  it("shows request status and the landlord update", () => {
    const markup = renderToStaticMarkup(<TenantMaintenancePanel rentals={[{ lease: { id: "lease_1", status: "active" },
      unit: { label: "Main residence" }, maintenanceRequests: [{ id: "request_1", title: "Leaking sink",
        description: "Water under cabinet", status: "scheduled", ownerNotes: "Plumber scheduled Friday." }] }]} />);
    expect(markup).toContain("Leaking sink");
    expect(markup).toContain("scheduled");
    expect(markup).toContain("Plumber scheduled Friday");
  });
  it("shows tenant-safe appointment details and public work updates",()=>{const markup=renderToStaticMarkup(<TenantMaintenancePanel rentals={[{lease:{id:"lease_1",status:"active"},unit:{label:"Main residence"},maintenanceRequests:[{id:"request_1",title:"Leaking sink",description:"Water",status:"scheduled",workOrders:[{id:"work_1",status:"scheduled",scheduledStart:"2026-08-14T14:00:00Z",updates:[{id:"event_1",publicNote:"Plumber confirmed."}]}]}]}]}/>);expect(markup).toContain("Work order: scheduled");expect(markup).toContain("Appointment:");expect(markup).toContain("Plumber confirmed.");});
});
