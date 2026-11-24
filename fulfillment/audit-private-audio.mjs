// Verify the actual mapped private files in production without transmitting audio.
// This checks object identity, byte size and format signatures, not listening QA or rights.
import manifest from "./private-master-key-digests.json" with {type:"json"};
import {sha256} from "./production-checkout-service.mjs";
export function validAudioHeader(format,b){
 if(!(b instanceof Uint8Array)||b.length<12)return false;
 if(format==="wav")return String.fromCharCode(...b.slice(0,4))==="RIFF"&&String.fromCharCode(...b.slice(8,12))==="WAVE";
 if(format==="mp3")return String.fromCharCode(...b.slice(0,3))==="ID3"||(b[0]===255&&(b[1]&224)===224&&(b[1]&24)!==8&&(b[1]&6)!==0);
 return false;
}
export async function auditPrivateAudio(env){
 if(env.LIVE_CHECKOUT_ENABLED!=="false"||env.CHECKOUT_ROUTES_ENABLED!=="false"||env.REAL_AUDIO_DELIVERY_ENABLED!=="false"||env.LICENSE_ISSUANCE_ENABLED!=="false")throw Error("Release lock required");
 const db=env.ORDERS_DB,bucket=env.INSTRUMENTAL_MASTERS;
 const rows=(await db.prepare("SELECT a.product_id,a.format,a.r2_object_key,a.size_bytes,p.sale_enabled FROM commerce_audio_assets a JOIN commerce_products p ON p.product_id=a.product_id").all()).results;
 if(rows.length!==72||new Set(rows.map(a=>a.product_id)).size!==36||rows.some(a=>a.sale_enabled!==0))throw Error("Unexpected inventory");
 const byId=new Map(manifest.assets.map(a=>[a.product_id+":"+a.format,a.key_sha256]));
 for(let i=0;i<rows.length;i+=8){
  await Promise.all(rows.slice(i,i+8).map(async a=>{
   if(await sha256(a.r2_object_key)!==byId.get(a.product_id+":"+a.format))throw Error("Private mapping mismatch");
   const head=await bucket.head(a.r2_object_key);
   if(!head||head.size!==a.size_bytes||head.size<2048)throw Error("Private size mismatch");
   const part=await bucket.get(a.r2_object_key,{range:{offset:0,length:12}});
   if(!part||!validAudioHeader(a.format,new Uint8Array(await part.arrayBuffer())))throw Error("Private format mismatch");
  }));
 }
 // No rights, listening, or sale flags are modified.
 return {verified:true,tracks:36,mp3:rows.filter(a=>a.format==="mp3").length,wav:rows.filter(a=>a.format==="wav").length,scope:"MAPPED_OBJECT_SIZE_AND_FORMAT_HEADER",paymentsEnabled:false,deliveryEnabled:false};
}
