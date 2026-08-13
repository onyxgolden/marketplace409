import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

const BUCKET="rental-documents";
const TYPES=new Set(["application/pdf","image/jpeg","image/png","text/plain"]);
const CATEGORIES=new Set(["lease","addendum","notice","inspection","receipt","other"]);
const safe=(value)=>value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"document";

export async function GET(){
  try{ const authenticated=await createAuthenticatedForgeApplication(); if(authenticated.response)return authenticated.response;
    const [{data,error},{data:preparations,error:preparationError},{data:versions,error:versionError}]=await Promise.all([authenticated.supabaseClient.from("rental_documents")
      .select("owner_id, id, lease_id, category, title, bucket, object_path, original_filename, mime_type, byte_size, tenant_visible, published_at, created_at")
      .order("created_at",{ascending:false}),authenticated.supabaseClient.from("rental_lease_preparations").select("id, lease_id, title, status, current_version, approved_version, approved_at").order("updated_at",{ascending:false}),authenticated.supabaseClient.from("rental_lease_preparation_versions").select("preparation_id, version_number, terms, change_summary, created_at").order("version_number",{ascending:false})]);
    if(error||preparationError||versionError)throw error||preparationError||versionError;
    const documents=await Promise.all((data||[]).map(async(document)=>{ const [signed,acknowledgements]=await Promise.all([
      authenticated.supabaseClient.storage.from(document.bucket).createSignedUrl(document.object_path,600),
      authenticated.supabaseClient.from("rental_document_acknowledgements").select("tenant_id, acknowledged_at, acknowledgement_version").eq("owner_id",document.owner_id).eq("document_id",document.id)
    ]); if(signed.error)throw signed.error;if(acknowledgements.error)throw acknowledgements.error;
      return {...document,download_url:signed.data.signedUrl,acknowledgements:acknowledgements.data||[]}; }));
    const leasePreparations=(preparations||[]).map(preparation=>({...preparation,versions:(versions||[]).filter(version=>version.preparation_id===preparation.id)}));
    return NextResponse.json({success:true,documents,leasePreparations});
  }catch(error){console.error("Rental document query error",error);return NextResponse.json({error:"Unable to load rental documents."},{status:500});}
}

export async function PATCH(request){
  try{const authenticated=await createAuthenticatedForgeApplication();if(authenticated.response)return authenticated.response;
    const body=await request.json();if(body?.operation!=="acknowledge-document"||typeof body.documentId!=="string"||body.documentId.trim()==="")
      return NextResponse.json({error:"A supported document acknowledgement is required."},{status:400});
    const {data,error}=await authenticated.supabaseClient.rpc("acknowledge_rental_document",{p_document_id:body.documentId.trim()});
    if(error)throw error;return NextResponse.json({success:true,acknowledgement:data});
  }catch(error){console.error("Rental document acknowledgement error",error);return NextResponse.json({error:error instanceof Error?error.message:"Unable to acknowledge the rental document."},{status:500});}
}

export async function POST(request){
  try{ const authenticated=await createAuthenticatedForgeApplication(); if(authenticated.response)return authenticated.response;
    const {data:tenant,error:tenantError}=await authenticated.supabaseClient.from("rental_tenants").select("id").eq("auth_user_id",authenticated.user.id).maybeSingle();
    if(tenantError)throw tenantError; if(tenant)return NextResponse.json({error:"Only a landlord can publish rental documents."},{status:403});
    const form=await request.formData(); const file=form.get("file"); const leaseId=String(form.get("leaseId")||"").trim();
    const title=String(form.get("title")||"").trim(); const category=String(form.get("category")||"").trim();
    if(!(file instanceof File)||file.size===0)return NextResponse.json({error:"A document file is required."},{status:400});
    if(!leaseId||!title||!CATEGORIES.has(category))return NextResponse.json({error:"Lease, title, and a supported category are required."},{status:400});
    if(!TYPES.has(file.type)||file.size>10485760)return NextResponse.json({error:"Use a PDF, JPG, PNG, or text file no larger than 10 MB."},{status:400});
    const id=`rental_document_${crypto.randomUUID()}`; const objectPath=`${authenticated.user.id}/${leaseId}/${id}/${safe(file.name)}`;
    const upload=await authenticated.supabaseClient.storage.from(BUCKET).upload(objectPath,new Uint8Array(await file.arrayBuffer()),{contentType:file.type,upsert:false});
    if(upload.error)throw upload.error;
    const visible=form.get("tenantVisible")==="true"; const now=new Date().toISOString();
    const inserted=await authenticated.supabaseClient.from("rental_documents").insert({owner_id:authenticated.user.id,id,lease_id:leaseId,
      category,title,bucket:BUCKET,object_path:objectPath,original_filename:file.name,mime_type:file.type,byte_size:file.size,
      tenant_visible:visible,published_at:visible?now:null,updated_at:now}).select("id, title, tenant_visible").single();
    if(inserted.error){await authenticated.supabaseClient.storage.from(BUCKET).remove([objectPath]);throw inserted.error;}
    return NextResponse.json({success:true,document:inserted.data});
  }catch(error){console.error("Rental document upload error",error);return NextResponse.json({error:error instanceof Error?error.message:"Unable to upload the rental document."},{status:500});}
}
