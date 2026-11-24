import {reconcileVerifiedEvent} from "./paypal-event-reconciliation.mjs";
// Server-side checkout orchestration. No route may be enabled before final release.
import {productionPayPalClient} from "./production-paypal-client.mjs";
import {HELD_PRODUCTS,EXPECTED_PRICE_CENTS,EXPECTED_FORMATS,verifyPayPalWebhook} from "./paypal-payment-gates.mjs";
const hashRE=/^[a-f0-9]{64}$/;
const productRE=/^BRUA1-INS-\d{4}$/;
const sessionRE=/^[a-f0-9-]{36}$/;
const emailRE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const versionRE=/^BRUA1-LEGAL-APPROVED-[A-Z0-9_-]+$/;
const requiredFlags=["CHECKOUT_ROUTES_ENABLED","LIVE_CHECKOUT_ENABLED","LICENSE_ISSUANCE_ENABLED","REAL_AUDIO_DELIVERY_ENABLED","MERCHANT_IDENTITY_VERIFIED","FINAL_TERMS_PUBLISHED","OWNER_FINAL_GO_LIVE_SIGNOFF","RIGHTS_REVIEW_COMPLETED","DELIVERY_INTEGRATION_QA_PASS","PRODUCTION_PAYPAL_QA_PASS","WEBHOOK_SIGNATURE_QA_PASS","REFUND_AND_DISPUTE_QA_PASS","BUYER_RECEIPT_SERVICE_QA_PASS","PRIVACY_AND_REFUND_POLICY_APPROVED","TAX_CONFIGURATION_VERIFIED"];
export function productionCheckoutReady(env){
 return requiredFlags.every(f=>env?.[f]==="true")&&env.PAYPAL_ENVIRONMENT==="live"&&env.AGREEMENT_STATUS==="LEGAL_APPROVED"&&versionRE.test(env.APPROVED_TERMS_VERSION||"")&&hashRE.test(env.APPROVED_TERMS_SHA256||"")&&env.TAX_PRICE_MODE==="VERIFIED_FIXED_TOTAL_USD"&&!!env.ORDERS_DB&&!!env.PAYPAL_CLIENT_ID&&!!env.PAYPAL_CLIENT_SECRET&&!!env.PAYPAL_WEBHOOK_ID&&!!env.PAYPAL_MERCHANT_ID;
}
export async function sha256(value){
 return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,"0")).join("");
}
const now=()=>new Date().toISOString();
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const first=(db,sql,...args)=>stmt(db,sql,...args).first();
const changes=r=>Number(r?.meta?.changes||0);
function assert(condition,msg){if(!condition)throw Error(msg);}
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join("");
const selection=(r)=>({productId:r.product_id,tier:r.tier,sku:r.product_id+"-"+r.tier.toUpperCase(),priceCents:r.price_cents,currency:"USD",formats:EXPECTED_FORMATS[r.tier],termsVersion:r.terms_version,customId:r.product_id+":"+r.tier+":"+r.terms_version,paypalEnvironment:"production",fulfillment:"APPROVED_LICENSE_REQUIRED"});
async function verifyTerms(db,row,env){
 assert(row.terms_version===env.APPROVED_TERMS_VERSION&&row.terms_hash===env.APPROVED_TERMS_SHA256,"Agreement version changed");
 const terms=await first(db,"SELECT document_text FROM commerce_approved_terms WHERE version=? AND sha256=?",row.terms_version,row.terms_hash);
 const schedule=await first(db,"SELECT schedule_document FROM commerce_publishing_schedules WHERE product_id=? AND schedule_version=? AND schedule_sha256=?",row.product_id,row.schedule_version,row.schedule_hash);
 assert(terms&&schedule&&typeof terms.document_text==="string"&&typeof schedule.schedule_document==="string"&&await sha256(terms.document_text)===row.terms_hash&&await sha256(schedule.schedule_document)===row.schedule_hash,"Exact approved agreement and publishing schedule unavailable");
 return {terms:terms.document_text,schedule:schedule.schedule_document};
}
async function checkProduct(db,row){
 assert(productRE.test(row.product_id)&&!HELD_PRODUCTS.includes(row.product_id)&&Object.hasOwn(EXPECTED_PRICE_CENTS,row.tier)&&EXPECTED_PRICE_CENTS[row.tier]===row.price_cents,"Invalid purchase selection");
 const p=await first(db,"SELECT title,sale_enabled,rights_cleared,independent_qa_pass FROM commerce_products WHERE product_id=?",row.product_id);
 assert(p&&p.sale_enabled===1&&p.rights_cleared===1&&p.independent_qa_pass===1,"Track not cleared for sale");
 for(const fmt of EXPECTED_FORMATS[row.tier]){
  const a=await first(db,"SELECT private_r2_qa_pass,independent_qa_pass,rights_cleared FROM commerce_audio_assets WHERE product_id=? AND format=?",row.product_id,fmt);
  assert(a&&a.private_r2_qa_pass===1&&a.independent_qa_pass===1&&a.rights_cleared===1,"Audio not cleared for delivery");
 }
 return p;
}
async function authenticate(db,id,raw){
 assert(sessionRE.test(id||"")&&hashRE.test(raw||""),"Invalid checkout session");
 const row=await first(db,"SELECT * FROM commerce_checkout_sessions WHERE session_id=? AND token_hash=?",id,await sha256(raw));
 assert(row,"Unknown checkout session");
 return row;
}
export function createCheckoutService(env,{transport=fetch}={}){
 assert(productionCheckoutReady(env),"Production checkout locked");
 const db=env.ORDERS_DB, paypal=productionPayPalClient(env,transport);
 return Object.freeze({
  async offer(input){
   const row={product_id:input.productId,tier:input.tier,price_cents:EXPECTED_PRICE_CENTS[input.tier],terms_version:env.APPROVED_TERMS_VERSION,terms_hash:env.APPROVED_TERMS_SHA256};
   const product=await checkProduct(db,row);
   // Until version selection is explicitly configured, multiple approved
   // schedules for one track require operator review rather than guessing.
   const schedules=await stmt(db,"SELECT schedule_version,schedule_sha256 FROM commerce_publishing_schedules WHERE product_id=? LIMIT 2",row.product_id).all();
   assert(schedules.results?.length===1,"Track publishing schedule unavailable");
   row.schedule_version=schedules.results[0].schedule_version;
   row.schedule_hash=schedules.results[0].schedule_sha256;
   const docs=await verifyTerms(db,row,env);
   return {productId:row.product_id,title:product.title,tier:row.tier,priceCents:row.price_cents,currency:"USD",termsVersion:row.terms_version,termsHash:row.terms_hash,scheduleVersion:row.schedule_version,scheduleHash:row.schedule_hash,agreement:docs.terms,publishingSchedule:docs.schedule};
  },
  async begin(input){
   assert(input?.accepted===true&&input?.publishingAccepted===true,"Affirmative agreement and publishing acceptance required");
   const buyer=String(input.buyerEmail||"").trim();
   assert(emailRE.test(buyer)&&buyer.length<=254,"Valid buyer email required");
   const row={product_id:input.productId,tier:input.tier,price_cents:EXPECTED_PRICE_CENTS[input.tier],terms_version:input.termsVersion,terms_hash:input.termsHash,schedule_version:input.scheduleVersion,schedule_hash:input.scheduleHash};
   assert(hashRE.test(row.schedule_hash||"")&&typeof row.schedule_version==="string"&&row.schedule_version.length<=100,"Publishing schedule required");
   await checkProduct(db,row);await verifyTerms(db,row,env);
   const id=crypto.randomUUID(),raw=token();
   await stmt(db,"INSERT INTO commerce_checkout_sessions(session_id,token_hash,product_id,tier,price_cents,buyer_email,terms_version,terms_hash,schedule_version,schedule_hash,accepted_at,status,created_at_epoch) VALUES(?,?,?,?,?,?,?,?,?,?,?,'ACCEPTED',?)",id,await sha256(raw),row.product_id,row.tier,row.price_cents,buyer,row.terms_version,row.terms_hash,row.schedule_version,row.schedule_hash,now(),Math.floor(Date.now()/1000)).run();
   return {sessionId:id,sessionToken:raw,amountCents:row.price_cents,currency:"USD"};
  },
  async create(input){
   const r=await authenticate(db,input.sessionId,input.sessionToken);
   assert(r.status==="ACCEPTED"&&Math.floor(Date.now()/1000)-r.created_at_epoch<=1800,"Checkout expired or already started; reconcile before retry");
   await checkProduct(db,r);await verifyTerms(db,r,env);
   assert(changes(await stmt(db,"UPDATE commerce_checkout_sessions SET status='CREATING' WHERE session_id=? AND status='ACCEPTED'",r.session_id).run())===1,"Checkout already claimed");
   // If network or database fails after the claim, retain CREATING for reconciliation.
   const provider=await paypal.create(selection(r),"create-"+r.session_id,true);
   await db.batch([
    stmt(db,"INSERT INTO commerce_orders(paypal_order_id,product_id,license_tier,amount_cents,currency,buyer_email,status) VALUES(?,?,?,?,'USD',?,'CREATED')",provider.orderId,r.product_id,r.tier,r.price_cents,r.buyer_email),
    stmt(db,"INSERT INTO commerce_terms_acceptance VALUES(?,?,?,?,?,1,?)",provider.orderId,r.product_id,r.tier,r.terms_version,r.terms_hash,r.accepted_at),
    stmt(db,"INSERT INTO commerce_publishing_acceptance VALUES(?,?,?,?,?)",provider.orderId,r.product_id,r.schedule_version,r.schedule_hash,r.accepted_at),
    stmt(db,"UPDATE commerce_checkout_sessions SET status='CREATED',paypal_order_id=? WHERE session_id=? AND status='CREATING'",provider.orderId,r.session_id)
   ]);
   return {orderId:provider.orderId,approve:provider.approve};
  },
  async capture(input){
   const r=await authenticate(db,input.sessionId,input.sessionToken);
   assert(r.paypal_order_id&&["CREATED","CAPTURING","COMPLETED"].includes(r.status),"No capturable order");
   const product=await checkProduct(db,r),docs=await verifyTerms(db,r,env);
   const order=await first(db,"SELECT * FROM commerce_orders WHERE paypal_order_id=?",r.paypal_order_id);
   assert(order&&order.product_id===r.product_id&&order.license_tier===r.tier&&order.amount_cents===r.price_cents&&order.buyer_email===r.buyer_email&&!order.refunded_at&&!order.chargeback_at&&!order.revoked_at&&["CREATED","CAPTURING","COMPLETED"].includes(order.status),"Order requires reconciliation");
   const a=await first(db,"SELECT * FROM commerce_terms_acceptance WHERE paypal_order_id=? AND terms_version=?",r.paypal_order_id,r.terms_version);
   const b=await first(db,"SELECT * FROM commerce_publishing_acceptance WHERE paypal_order_id=?",r.paypal_order_id);
   assert(a&&a.product_id===r.product_id&&a.license_tier===r.tier&&a.terms_sha256===r.terms_hash&&a.affirmatively_accepted===1&&b&&b.product_id===r.product_id&&b.schedule_version===r.schedule_version&&b.schedule_sha256===r.schedule_hash,"Acceptance mismatch");
   let payment;
   if(r.status==="CREATED"&&order.status==="CREATED"){
    const ready=await paypal.reconcile(r.paypal_order_id,selection(r));
    assert(ready.completed||ready.status==="APPROVED","Buyer approval not yet verified");
    const claim=await stmt(db,"UPDATE commerce_orders SET status='CAPTURING' WHERE paypal_order_id=? AND status='CREATED' AND revoked_at IS NULL AND refunded_at IS NULL AND chargeback_at IS NULL",r.paypal_order_id).run();
    assert(changes(claim)===1,"Capture already claimed; reconcile");
    await stmt(db,"UPDATE commerce_checkout_sessions SET status='CAPTURING' WHERE session_id=? AND status='CREATED'",r.session_id).run();
    payment=ready.completed?ready.payment:await paypal.capture(r.paypal_order_id,selection(r),"capture-"+r.session_id,true);
   }else{
    const result=await paypal.reconcile(r.paypal_order_id,selection(r));
    assert(result.completed,"Capture outcome unresolved; do not recapture");
    payment=result.payment;
   }
   // Persist verified payment, not a license until actual immutable document exists.
   const write=await stmt(db,"UPDATE commerce_orders SET status='COMPLETED',paypal_capture_id=?,payment_verified_at=COALESCE(payment_verified_at,?) WHERE paypal_order_id=? AND status IN ('CAPTURING','COMPLETED') AND revoked_at IS NULL AND refunded_at IS NULL AND chargeback_at IS NULL AND (paypal_capture_id IS NULL OR paypal_capture_id=?)",payment.capture_id,now(),r.paypal_order_id,payment.capture_id).run();
   assert(changes(write)===1,"Payment reconciliation required");
   const latest=await first(db,"SELECT status,paypal_capture_id,revoked_at,refunded_at,chargeback_at FROM commerce_orders WHERE paypal_order_id=?",r.paypal_order_id);
   assert(latest?.status==="COMPLETED"&&latest.paypal_capture_id===payment.capture_id&&!latest.revoked_at&&!latest.refunded_at&&!latest.chargeback_at,"Order no longer eligible");
   const licenseId="BRUA1-LIC-"+r.session_id;
   const issuedAt=now();
   const document=["BruA1 Instrumental License","License ID: "+licenseId,"Buyer: "+r.buyer_email,"Instrumental: "+product.title+" ("+r.product_id+")","Tier: "+r.tier,"Paid: USD "+(r.price_cents/100).toFixed(2),"PayPal order: "+r.paypal_order_id,"Capture: "+payment.capture_id,"Accepted at: "+r.accepted_at,"Agreement version: "+r.terms_version,"Agreement SHA-256: "+r.terms_hash,"Publishing version: "+r.schedule_version,"Publishing SHA-256: "+r.schedule_hash,"Issued at: "+issuedAt,"",docs.terms,"",docs.schedule].join("\n");
   const documentHash=await sha256(document);
   // Atomic insert, conditionally on current completed/unrevoked order. Retrying
   // cannot overwrite existing licenses or documents.
   await db.batch([
    stmt(db,"INSERT INTO commerce_licenses(license_id,paypal_order_id,product_id,tier,agreement_version,agreement_sha256,document_sha256,status,buyer_email,issued_at) SELECT ?,?,?,?,?,?,?,'ISSUED',?,? FROM commerce_orders WHERE paypal_order_id=? AND status='COMPLETED' AND paypal_capture_id=? AND revoked_at IS NULL AND refunded_at IS NULL AND chargeback_at IS NULL ON CONFLICT(paypal_order_id) DO NOTHING",licenseId,r.paypal_order_id,r.product_id,r.tier,r.terms_version,r.terms_hash,documentHash,r.buyer_email,issuedAt,r.paypal_order_id,payment.capture_id),
    stmt(db,"INSERT INTO commerce_license_documents(license_id,document_text,document_sha256,schedule_version,schedule_hash) SELECT ?,?,?,?,? FROM commerce_licenses WHERE license_id=? AND document_sha256=? AND status='ISSUED' ON CONFLICT(license_id) DO NOTHING",licenseId,document,documentHash,r.schedule_version,r.schedule_hash,licenseId,documentHash),
    stmt(db,"UPDATE commerce_checkout_sessions SET status='COMPLETED' WHERE session_id=? AND status IN ('CREATED','CAPTURING','COMPLETED') AND EXISTS(SELECT 1 FROM commerce_license_documents WHERE license_id=?)",r.session_id,licenseId)
   ]);
   const issued=await first(db,"SELECT l.status,l.document_sha256,d.document_text,d.document_sha256 AS stored_hash,d.schedule_version,d.schedule_hash FROM commerce_licenses l JOIN commerce_license_documents d ON d.license_id=l.license_id WHERE l.license_id=?",licenseId);
   assert(issued?.status==="ISSUED"&&issued.document_sha256===issued.stored_hash&&await sha256(issued.document_text)===issued.stored_hash&&issued.schedule_version===r.schedule_version&&issued.schedule_hash===r.schedule_hash,"Paid order requires license reconciliation");
   return {orderId:r.paypal_order_id,licenseId,paymentVerified:true,licenseDocument:issued.document_text,deliveryStatus:"REQUIRES_AUTHORIZED_GRANT_SERVICE"};
  }
 });
}
// Verified webhook inbox only. Every event requires reconciliation; no grant or
// refund is issued from a webhook payload alone.
export async function receiveVerifiedWebhook(env,headers,event,transport=fetch){
 assert(env?.PAYPAL_ENVIRONMENT==="live"&&env.PAYPAL_WEBHOOK_ID&&env.ORDERS_DB&&env.PAYPAL_CLIENT_ID&&env.PAYPAL_CLIENT_SECRET,"Webhook configuration missing");
 const auth=await transport("https://api-m.paypal.com/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET),"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
 assert(auth.ok,"PayPal authentication failed");
 const accessToken=(await auth.json()).access_token;
 const verified=await verifyPayPalWebhook({headers,webhook:event,webhookId:env.PAYPAL_WEBHOOK_ID,accessToken,mode:"production",transport});
 if(!verified.relevant)return {accepted:true,ignored:true};
 assert(typeof verified.event_id==="string"&&verified.event_id.length<=128,"Invalid event ID");
 const resource=typeof event.resource?.id==="string"&&event.resource.id.length<=128?event.resource.id:null;
 await stmt(env.ORDERS_DB,"INSERT INTO commerce_webhook_inbox(event_id,event_type,resource_id,received_at) VALUES(?,?,?,?) ON CONFLICT(event_id) DO NOTHING",verified.event_id,verified.type,resource,now()).run();
 if(env.WEBHOOK_RECONCILIATION_ENABLED==="true"){
  const result=await reconcileVerifiedEvent(env,event,verified,accessToken,transport);
  return {accepted:true,reconciliationRequired:result.status==="MANUAL_REVIEW"};
 }
 return {accepted:true,reconciliationRequired:true};
}
