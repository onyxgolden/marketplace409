import{describe,expect,it}from"vitest";import{decodeReservationPreview,encodeReservationPreview}from"./previewToken";
const key="reservation-preview-secret-with-more-than-thirty-two-characters";
describe("reservation preview token",()=>{
 it("round-trips owner, actor, inputs, and quote",()=>{const token=encodeReservationPreview({ownerId:"owner",actingUserId:"actor",input:{unitId:"u1"},quote:{totalDueCents:10000}},{key,now:1000});expect(decodeReservationPreview(token,{key,now:2000})).toMatchObject({ownerId:"owner",actingUserId:"actor",input:{unitId:"u1"},quote:{totalDueCents:10000}})});
 it("rejects tampering",()=>{const token=encodeReservationPreview({ownerId:"owner"},{key});expect(()=>decodeReservationPreview(`${token}x`,{key})).toThrow("invalid")});
 it("rejects expiration",()=>{const token=encodeReservationPreview({ownerId:"owner"},{key,now:1000,ttlMs:10});expect(()=>decodeReservationPreview(token,{key,now:1011})).toThrow("expired")});
});
