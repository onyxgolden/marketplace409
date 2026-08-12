import { beforeEach,describe,expect,it,vi } from "vitest";
const from=vi.fn();const createSignedUrl=vi.fn();const upload=vi.fn();const remove=vi.fn();
const authenticated={user:{id:"owner_1"},supabaseClient:{from,storage:{from:vi.fn(()=>({createSignedUrl,upload,remove}))}}};
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication",()=>({createAuthenticatedForgeApplication:vi.fn(async()=>authenticated)}));
import { GET,POST } from "./route.js";
const chain=(result)=>{const value={select:vi.fn(),eq:vi.fn(),order:vi.fn(),maybeSingle:vi.fn()};Object.values(value).forEach(method=>method.mockReturnValue(value));value.order.mockResolvedValue(result);value.maybeSingle.mockResolvedValue(result);return value;};
describe("rental documents route",()=>{
  beforeEach(()=>vi.clearAllMocks());
  it("returns short-lived signed links for documents visible through RLS",async()=>{const query=chain({data:[{id:"document_1",bucket:"rental-documents",object_path:"owner_1/lease_1/file.pdf",title:"Lease"}],error:null});from.mockReturnValue(query);createSignedUrl.mockResolvedValue({data:{signedUrl:"https://signed.test/file"},error:null});
    const response=await GET();const body=await response.json();expect(response.status).toBe(200);expect(body.documents[0].download_url).toBe("https://signed.test/file");expect(createSignedUrl).toHaveBeenCalledWith("owner_1/lease_1/file.pdf",600);
  });
  it("blocks a linked tenant from publishing documents",async()=>{const tenantQuery=chain({data:{id:"tenant_1"},error:null});from.mockReturnValue(tenantQuery);
    const response=await POST(new Request("https://example.test/api/rental/documents",{method:"POST",body:new FormData()}));expect(response.status).toBe(403);expect(upload).not.toHaveBeenCalled();
  });
});
