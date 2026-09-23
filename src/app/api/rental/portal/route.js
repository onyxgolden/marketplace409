import { NextResponse } from "next/server";
import { createAuthenticatedTenantPortalApplication } from "@/lib/supabase/createAuthenticatedTenantPortalApplication";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { validatePublishableKeyMode } from "@/infrastructure/billing/stripeMode";

// Server-side IP capture for the ACH mandate's online customer acceptance — what the request
// actually arrived with, never trusted from the client body (same pattern as sign-lease).
function serverIpAddress(request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return (forwardedFor ? forwardedFor.split(",")[0].trim() : null) || request.headers.get("x-real-ip");
}

// Loads the calling tenant's own setup_required autopay enrollment. Tenant RLS grants SELECT
// on enrollments but no UPDATE, so the activation write below goes through this explicit
// owner_id + tenant_id scoping on the service-role client instead of the RLS-scoped one.
async function loadTenantAutopayEnrollment(database, authUserId, enrollmentId) {
  const { data: tenant, error: tenantError } = await database.from("rental_tenants").select("*")
    .eq("auth_user_id", authUserId).maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant) return { tenant: null, enrollment: null };
  const { data: enrollment, error: enrollmentError } = await database.from("rental_autopay_enrollments").select("*")
    .eq("owner_id", tenant.owner_id).eq("id", enrollmentId).eq("tenant_id", tenant.id)
    .eq("status", "setup_required").maybeSingle();
  if (enrollmentError) throw enrollmentError;
  return { tenant, enrollment };
}

async function loadLandlordStripeAccount(database, ownerId, mode) {
  const { data: account, error } = await database.from("landlord_payment_accounts").select("*")
    .eq("owner_id", ownerId).eq("provider", "stripe").eq("provider_mode", mode).maybeSingle();
  if (error) throw error;
  return account;
}

// Same load-or-create customer reference pattern as the one-time payment session: the
// connected account and provider mode scope the customer so a sandbox customer can never be
// charged against a live connected account, in either direction.
async function loadOrCreateTenantCustomer(database, provider, account, tenant) {
  const { data: existing, error: lookupError } = await database.from("billing_customer_references").select("*")
    .eq("owner_id", tenant.owner_id).eq("tenant_id", tenant.id).eq("provider", "stripe")
    .eq("provider_mode", provider.mode).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing;
  const created = await provider.createCustomer(
    { ownerId: tenant.owner_id, connectedAccountId: account.provider_account_id },
    { tenantId: tenant.id, email: tenant.email, displayName: tenant.display_name },
    `billing-customer:${provider.mode}:${tenant.owner_id}:${tenant.id}:stripe`);
  const { data: saved, error: saveError } = await database.from("billing_customer_references").upsert({
    owner_id: tenant.owner_id, tenant_id: tenant.id, provider: "stripe", provider_mode: provider.mode,
    connected_account_id: account.provider_account_id, customer_id: created.customerId,
  }, { onConflict: "owner_id,tenant_id,provider,provider_mode" }).select("*").single();
  if (saveError) throw saveError;
  return saved;
}
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
    if(body?.operation==="set-optional-reminders"){if(typeof body.enabled!=="boolean")return NextResponse.json({error:"enabled must be boolean."},{status:400});const{data,error}=await authenticated.supabaseClient.rpc("set_rental_optional_reminders",{p_enabled:body.enabled});if(error)throw error;return NextResponse.json({success:true,preferences:data});}
    if(body?.operation==="request-animal"){if(!body.leaseId||!body.name?.trim()||!body.breedDescription?.trim()||!["pet","assistance_review_requested"].includes(body.requestType))return NextResponse.json({error:"Lease, animal details, and request type are required."},{status:400});const{data,error}=await authenticated.supabaseClient.rpc("request_rental_animal",{p_lease_id:body.leaseId,p_name:body.name.trim(),p_breed_description:body.breedDescription.trim(),p_request_type:body.requestType});if(error)throw error;return NextResponse.json({success:true,animal:data});}
    if(body?.operation==="request-autopay"){
      if(!body.leaseId||!["card","us_bank_account"].includes(body.paymentMethodType)||body.consentConfirmed!==true)return NextResponse.json({error:"Lease, payment method, and explicit consent are required."},{status:400});
      const consentText="I authorize recurring rent payments under the displayed schedule, understand Stripe payment-method and mandate setup is required before activation, and may cancel future payments.";
      const provider=createStripeBillingProvider();
      const{data,error}=await authenticated.supabaseClient.rpc("request_rental_autopay_enrollment",{p_lease_id:body.leaseId,p_payment_method_type:body.paymentMethodType,p_charge_day:Number(body.chargeDay),p_reminder_days_before:Number(body.reminderDaysBefore),p_consent_text:consentText,p_provider_mode:provider.mode});if(error)throw error;return NextResponse.json({success:true,enrollment:data});
    }
    if(body?.operation==="cancel-autopay"){
      if(!body.enrollmentId)return NextResponse.json({error:"enrollmentId is required."},{status:400});const{data,error}=await authenticated.supabaseClient.rpc("cancel_rental_autopay_enrollment",{p_enrollment_id:body.enrollmentId,p_reason:body.reason||"Cancelled by tenant"});if(error)throw error;return NextResponse.json({success:true,enrollment:data});
    }
    if(body?.operation==="create-autopay-setup"){
      if(typeof body.enrollmentId!=="string"||!body.enrollmentId.trim())return NextResponse.json({error:"enrollmentId is required."},{status:400});
      const database=createRentalWebhookClient();
      const provider=createStripeBillingProvider();
      // Fail before any Stripe work on a publishable-key/mode mismatch — the tenant's browser
      // would otherwise only discover it when confirming the bank form, after a SetupIntent exists.
      validatePublishableKeyMode(provider.mode);
      const{tenant,enrollment}=await loadTenantAutopayEnrollment(database,authenticated.user.id,body.enrollmentId.trim());
      if(!tenant)return NextResponse.json({error:"No tenant portal access is linked to this account."},{status:403});
      if(!enrollment)return NextResponse.json({error:"No pending autopay enrollment was found for this tenant."},{status:404});
      if(enrollment.payment_method_type!=="us_bank_account")return NextResponse.json({error:"Automatic bank setup is only available for US bank account enrollments."},{status:400});
      const account=await loadLandlordStripeAccount(database,tenant.owner_id,provider.mode);
      if(!account?.provider_account_id||account.status!=="enabled"||!account.charges_enabled||!account.payouts_enabled)
        return NextResponse.json({error:"The landlord payment account is not ready."},{status:409});
      const customer=await loadOrCreateTenantCustomer(database,provider,account,tenant);
      const setup=await provider.createAutopaySetupIntent(
        {ownerId:tenant.owner_id,connectedAccountId:account.provider_account_id},
        {customerId:customer.customer_id,enrollmentId:enrollment.id,leaseId:enrollment.lease_id,tenantId:tenant.id,
          ipAddress:serverIpAddress(request),userAgent:request.headers.get("user-agent"),
          idempotencyKey:`autopay-setup:${enrollment.id}:${crypto.randomUUID()}`});
      return NextResponse.json({success:true,enrollmentId:enrollment.id,setupIntentId:setup.setupIntentId,
        clientSecret:setup.clientSecret,connectedAccountId:setup.connectedAccountId});
    }
    if(body?.operation==="complete-autopay-setup"){
      if(typeof body.enrollmentId!=="string"||!body.enrollmentId.trim()||typeof body.setupIntentId!=="string"||!body.setupIntentId.trim())
        return NextResponse.json({error:"enrollmentId and setupIntentId are required."},{status:400});
      const database=createRentalWebhookClient();
      const provider=createStripeBillingProvider();
      const{tenant,enrollment}=await loadTenantAutopayEnrollment(database,authenticated.user.id,body.enrollmentId.trim());
      if(!tenant)return NextResponse.json({error:"No tenant portal access is linked to this account."},{status:403});
      if(!enrollment)return NextResponse.json({error:"No pending autopay enrollment was found for this tenant."},{status:404});
      const account=await loadLandlordStripeAccount(database,tenant.owner_id,provider.mode);
      if(!account?.provider_account_id||account.status!=="enabled"||!account.charges_enabled)
        return NextResponse.json({error:"The landlord payment account is not ready."},{status:409});
      const intent=await provider.retrieveAutopaySetupIntent(
        {ownerId:tenant.owner_id,connectedAccountId:account.provider_account_id},body.setupIntentId.trim());
      if(intent.status!=="succeeded")return NextResponse.json({error:"Bank account setup is not complete yet."},{status:409});
      // Bind the SetupIntent to this exact enrollment and customer: a tenant must not be able
      // to activate autopay with another tenant's (or another enrollment's) setup intent.
      if(intent.enrollmentId!==enrollment.id)
        return NextResponse.json({error:"This bank setup does not belong to this autopay enrollment."},{status:403});
      const{data:customer,error:customerError}=await database.from("billing_customer_references").select("*")
        .eq("owner_id",tenant.owner_id).eq("tenant_id",tenant.id).eq("provider","stripe")
        .eq("provider_mode",provider.mode).maybeSingle();
      if(customerError)throw customerError;
      if(!customer||intent.customerId!==customer.customer_id)
        return NextResponse.json({error:"This bank setup does not belong to this tenant."},{status:403});
      if(!intent.paymentMethodId)
        return NextResponse.json({error:"Bank account setup completed without a payment method."},{status:409});
      if(!intent.mandateId)
        return NextResponse.json({error:"Bank account setup completed without a debit authorization."},{status:409});
      const timestamp=new Date().toISOString();
      const{data:activated,error:updateError}=await database.from("rental_autopay_enrollments")
        .update({status:"active",provider_customer_id:customer.customer_id,
          provider_payment_method_id:intent.paymentMethodId,provider_mandate_id:intent.mandateId,
          activated_at:timestamp,updated_at:timestamp})
        .eq("owner_id",tenant.owner_id).eq("id",enrollment.id).eq("tenant_id",tenant.id)
        .eq("status","setup_required").select("*").single();
      if(updateError)throw updateError;
      return NextResponse.json({success:true,enrollment:activated});
    }
    if(body?.operation==="acknowledge-inspection"){
      if(typeof body.inspectionId!=="string"||!body.inspectionId.trim())return NextResponse.json({error:"inspectionId is required."},{status:400});
      const {data,error}=await authenticated.supabaseClient.rpc("acknowledge_rental_inspection",{p_inspection_id:body.inspectionId.trim()});
      if(error)throw error;return NextResponse.json({success:true,acknowledgement:data});
    }
    if(body?.operation==="sign-lease"){
      if(typeof body.leaseId!=="string"||!body.leaseId.trim()||typeof body.preparationId!=="string"||!body.preparationId.trim()
        ||!Number.isInteger(body.versionNumber)||typeof body.signerName!=="string"||!body.signerName.trim())
        return NextResponse.json({error:"Lease, preparation, version, and a typed signer name are required."},{status:400});
      // Captured server-side, never trusted from the client -- the ip/user-agent recorded on the
      // signature are what the request actually arrived with, not whatever a caller could claim.
      const forwardedFor=request.headers.get("x-forwarded-for");
      const ipAddress=(forwardedFor?forwardedFor.split(",")[0].trim():null)||request.headers.get("x-real-ip");
      const{data,error}=await authenticated.supabaseClient.rpc("sign_rental_lease_preparation_version",{
        p_lease_id:body.leaseId.trim(),p_preparation_id:body.preparationId.trim(),p_version_number:body.versionNumber,
        p_signer_name:body.signerName.trim(),p_ip_address:ipAddress,p_user_agent:request.headers.get("user-agent"),
      });
      if(error)throw error;return NextResponse.json({success:true,signature:data});
    }
    if(body?.operation==="send-message"){
      if(typeof body.body!=="string"||!body.body.trim())return NextResponse.json({error:"A message body is required."},{status:400});
      if(body.category!==undefined&&body.category!==null&&!["issue","suggestion"].includes(body.category))
        return NextResponse.json({error:"category must be \"issue\", \"suggestion\", or omitted."},{status:400});
      const{data,error}=await authenticated.supabaseClient.rpc("send_rental_conversation_tenant_message",{p_body:body.body.trim(),p_category:body.category||null});
      if(error)throw error;return NextResponse.json({success:true,message:data});
    }
    if(body?.operation==="mark-conversation-read"){
      const{error}=await authenticated.supabaseClient.rpc("mark_rental_conversation_read_by_tenant");
      if(error)throw error;return NextResponse.json({success:true});
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
