// Link private inventory in D1; never return keys, promote rights, or enable a sale.
import {sha256} from "./production-checkout-service.mjs";
import manifest from "./private-master-key-digests.json" with {type:"json"};
export async function seedPrivateAssets(env){
 if(env.LIVE_CHECKOUT_ENABLED!=="false"||env.REAL_AUDIO_DELIVERY_ENABLED!=="false"||env.CHECKOUT_ROUTES_ENABLED!=="false")throw Error("Checkout lock required");
 const db=env.ORDERS_DB,bucket=env.INSTRUMENTAL_MASTERS;
 if(!db||!bucket)throw Error("Missing bindings");
 const expected=manifest.assets;
 if(expected.length!==72||new Set(expected.map(a=>a.product_id)).size!==36||new Set(expected.map(a=>a.key_sha256)).size!==72)throw Error("Invalid manifest");
 const byHash=new Map(expected.map(a=>[a.key_sha256,a])),found=new Map();
 let cursor;for(let page=0;page<20;page++){
  const result=await bucket.list({limit:1000,...(cursor?{cursor}:{})});
  for(const obj of result.objects){
   const hash=await sha256(obj.key);
   if(byHash.has(hash)){if(found.has(hash)||!Number.isSafeInteger(obj.size)||obj.size<2048)throw Error("Asset metadata invalid");found.set(hash,{key:obj.key,size:obj.size});}
  }
  if(!result.truncated){cursor=undefined;break;}
  cursor=result.cursor;if(!cursor)throw Error("R2 pagination unavailable");
 }
 if(cursor||found.size!==72)throw Error("Incomplete asset inventory");
 const products=await db.prepare("SELECT product_id,sale_enabled FROM commerce_products").all();
 if(products.results.length!==36||products.results.some(p=>p.sale_enabled!==0||!expected.some(a=>a.product_id===p.product_id)))throw Error("Unexpected product inventory");
 const existing=await db.prepare("SELECT product_id,format,r2_object_key FROM commerce_audio_assets").all();
 for(const a of existing.results){const match=expected.find(x=>x.product_id===a.product_id&&x.format===a.format);if(!match||found.get(match.key_sha256).key!==a.r2_object_key)throw Error("Conflicting existing mapping");}
 // R2 size/identity now verified. Do not mark human content QA or rights as passed.
 for(let i=0;i<expected.length;i+=24){
  const stmts=expected.slice(i,i+24).map(a=>{const f=found.get(a.key_sha256);return db.prepare("INSERT INTO commerce_audio_assets(product_id,format,r2_object_key,size_bytes,private_r2_qa_pass,independent_qa_pass,rights_cleared) VALUES(?,?,?,?,0,0,0) ON CONFLICT(product_id,format) DO NOTHING").bind(a.product_id,a.format,f.key,f.size);});
  await db.batch(stmts);
 }
 const audit=await db.prepare("SELECT COUNT(*) AS total,COUNT(DISTINCT product_id) AS tracks,SUM(CASE WHEN format='mp3' THEN 1 ELSE 0 END) AS mp3,SUM(CASE WHEN format='wav' THEN 1 ELSE 0 END) AS wav FROM commerce_audio_assets").first();
 if(audit.total!==72||audit.tracks!==36||audit.mp3!==36||audit.wav!==36)throw Error("Database readback mismatch");
 return {verified:true,tracks:36,assets:72,mp3:36,wav:36,paymentsEnabled:false,deliveryEnabled:false};
}
