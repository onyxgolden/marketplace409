import { NextResponse } from "next/server";
import { createAuthenticatedTenantPortalApplication } from "@/lib/supabase/createAuthenticatedTenantPortalApplication";
export async function GET() {
  try {
    const authenticated = await createAuthenticatedTenantPortalApplication();
    if (authenticated.response) return authenticated.response;
    let portal = await authenticated.application.load(authenticated.user.id);
    if (!portal) {
      const claim = await authenticated.supabaseClient.rpc("claim_rental_tenant_portal");
      if (claim.error) throw claim.error;
      if (claim.data) portal = await authenticated.application.load(authenticated.user.id);
    }
    if (!portal) return NextResponse.json({ error: "No tenant portal access is linked to this account." }, { status: 404 });
    return NextResponse.json({ success: true, portal });
  } catch (error) {
    console.error("Tenant portal query error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load the tenant portal." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedTenantPortalApplication();
    if (authenticated.response) return authenticated.response;
    const body = await request.json();
    if(body?.operation==="request-autopay"){
      if(!body.leaseId||!["card","us_bank_account"].includes(body.paymentMethodType)||body.consentConfirmed!==true)return NextResponse.json({error:"Lease, payment method, and explicit consent are required."},{status:400});
      const consentText="I authorize recurring rent payments under the displayed schedule, understand Stripe payment-method and mandate setup is required before activation, and may cancel future payments.";
      const{data,error}=await authenticated.supabaseClient.rpc("request_rental_autopay_enrollment",{p_lease_id:body.leaseId,p_payment_method_type:body.paymentMethodType,p_charge_day:Number(body.chargeDay),p_reminder_days_before:Number(body.reminderDaysBefore),p_consent_text:consentText});if(error)throw error;return NextResponse.json({success:true,enrollment:data});
    }
    if(body?.operation==="cancel-autopay"){
      if(!body.enrollmentId)return NextResponse.json({error:"enrollmentId is required."},{status:400});const{data,error}=await authenticated.supabaseClient.rpc("cancel_rental_autopay_enrollment",{p_enrollment_id:body.enrollmentId,p_reason:body.reason||"Cancelled by tenant"});if(error)throw error;return NextResponse.json({success:true,enrollment:data});
    }
    if(body?.operation==="acknowledge-inspection"){
      if(typeof body.inspectionId!=="string"||!body.inspectionId.trim())return NextResponse.json({error:"inspectionId is required."},{status:400});
      const {data,error}=await authenticated.supabaseClient.rpc("acknowledge_rental_inspection",{p_inspection_id:body.inspectionId.trim()});
      if(error)throw error;return NextResponse.json({success:true,acknowledgement:data});
    }
    if (body?.operation !== "submit-maintenance-request")
      return NextResponse.json({ error: "A supported tenant portal operation is required." }, { status: 400 });
    if (typeof body.leaseId !== "string" || body.leaseId.trim() === "")
      return NextResponse.json({ error: "leaseId is required." }, { status: 400 });
    if (typeof body.title !== "string" || body.title.trim() === "")
      return NextResponse.json({ error: "A maintenance request title is required." }, { status: 400 });
    if (typeof body.description !== "string" || body.description.trim() === "")
      return NextResponse.json({ error: "A maintenance request description is required." }, { status: 400 });
    const priority = ["routine", "soon", "urgent", "emergency"].includes(body.priority) ? body.priority : "routine";
    const { data, error } = await authenticated.supabaseClient.rpc("submit_rental_maintenance_request", {
      p_lease_id: body.leaseId.trim(), p_title: body.title.trim(), p_description: body.description.trim(),
      p_priority: priority, p_permission_to_enter: body.permissionToEnter === true,
      p_contact_phone: typeof body.contactPhone === "string" ? body.contactPhone.trim() || null : null,
    });
    if (error) throw error;
    return NextResponse.json({ success: true, request: data });
  } catch (error) {
    console.error("Tenant maintenance submission error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit the maintenance request." }, { status: 500 });
  }
}
