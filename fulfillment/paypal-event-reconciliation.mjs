// Reconcile authenticated events with PayPal's current server-side records.
// No payment capture, refund initiation, or automatic dispute adjudication.
const BASE="https://api-m.paypal.com";
const idOK=x=>typeof x==="string"&&/^[A-Za-z0-9-]{8,128}$/.test(x);
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
function relatedCapture(resource){
 const direct=resource?.supplementary_data?.related_ids?.capture_id;
 if(idOK(direct))return direct;
 const up=resource?.links?.find(l=>l.rel==="up"&&l.method==="GET")?.href;
 if(typeof up!=="string")return null;
 const url=new URL(up);
 const m=url.pathname.match(/^\/v2\/payments\/captures\/([A-Za-z0-9-]{8,128})$/);
 return url.protocol==="https:"&&["api-m.paypal.com","api.paypal.com"].includes(url.hostname)&&!url.username&&!url.password&&m?m[1]:null;
}
export async function reconcileVerifiedEvent(env,event,verified,accessToken,transport=fetch){
 if(!verified?.verified||verified.event_id!==event.id||verified.type!==event.event_type||env.PAYPAL_ENVIRONMENT!=="live"||!accessToken||!env.PAYPAL_MERCHANT_ID)throw Error("Verified merchant event required");
 const db=env.ORDERS_DB;
 const inbox=await stmt(db,"SELECT status,event_type FROM commerce_webhook_inbox WHERE event_id=?",event.id).first();
 if(!inbox||inbox.event_type!==event.event_type)throw Error("Verified inbox record required");
 if(inbox.status!=="RECONCILE_REQUIRED")return {status:inbox.status};
 async function get(path){
  const r=await transport(BASE+path,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
  if(!r.ok)throw Error("PayPal reconciliation unavailable");
  return r.json();
 }
 let captures=[],refund=null,dispute=null;
 if(event.event_type==="PAYMENT.CAPTURE.REFUNDED"){
  if(!idOK(event.resource?.id))throw Error("Invalid refund ID");
  refund=await get("/v2/payments/refunds/"+event.resource.id);
  if(refund.id!==event.resource.id||refund.status!=="COMPLETED")throw Error("Refund not completed");
  const c=relatedCapture(refund);if(!c)throw Error("Refund capture unavailable");captures=[c];
 }else if(event.event_type==="CUSTOMER.DISPUTE.CREATED"){
  const id=event.resource?.dispute_id||event.resource?.id;if(!idOK(id))throw Error("Invalid dispute ID");
  dispute=await get("/v1/customer/disputes/"+id);
  if(dispute.dispute_id!==id||typeof dispute.status!=="string")throw Error("Dispute unverified");
  captures=[...new Set((dispute.disputed_transactions||[]).map(x=>x.seller_transaction_id).filter(idOK))];
  if(!captures.length)throw Error("No seller transaction");
 }else{
  if(!idOK(event.resource?.id))throw Error("Invalid capture ID");captures=[event.resource.id];
 }
 let matched=0,actions=[];
 for(const capId of captures){
  const cap=await get("/v2/payments/captures/"+capId);
  if(cap.id!==capId||!cap.amount||cap.amount.currency_code!=="USD")throw Error("Capture unverified");
  let order=await stmt(db,"SELECT * FROM commerce_orders WHERE paypal_capture_id=?",capId).first();
  const linked=cap.supplementary_data?.related_ids?.order_id;
  if(!order&&idOK(linked))order=await stmt(db,"SELECT * FROM commerce_orders WHERE paypal_order_id=?",linked).first();
  if(!order)continue;
  if(order.paypal_capture_id&&order.paypal_capture_id!==capId)throw Error("Stored capture mismatch");
  const remote=await get("/v2/checkout/orders/"+order.paypal_order_id);
  const unit=remote.purchase_units?.[0];
  const acceptance=await stmt(db,"SELECT terms_version FROM commerce_terms_acceptance WHERE paypal_order_id=? AND affirmatively_accepted=1",order.paypal_order_id).first();
  if(remote.id!==order.paypal_order_id||remote.purchase_units?.length!==1||unit?.payee?.merchant_id!==env.PAYPAL_MERCHANT_ID||!acceptance||unit.custom_id!==order.product_id+":"+order.license_tier+":"+acceptance.terms_version||unit.amount?.currency_code!=="USD"||unit.amount?.value!==(order.amount_cents/100).toFixed(2)||cap.amount.value!==unit.amount.value||!unit.payments?.captures?.some(c=>c.id===capId))throw Error("Merchant, order or capture mismatch");
  matched++;
  if(cap.status==="REFUNDED"){
   actions.push({id:order.paypal_order_id,kind:"REFUNDED"});
  }else if(dispute||cap.status==="PARTIALLY_REFUNDED"||event.event_type==="PAYMENT.CAPTURE.REVERSED"){
   // A pending dispute or partial refund holds delivery, not the underlying license.
   actions.push({id:order.paypal_order_id,kind:"HOLD"});
  }else if(event.event_type==="PAYMENT.CAPTURE.COMPLETED"&&cap.status==="COMPLETED"){
   actions.push({id:order.paypal_order_id,kind:"VERIFIED_CAPTURE"});
  }else throw Error("Provider event state requires review");
 }
 // Never automatically reinstate an order after a hold or refund.
 const time=new Date().toISOString(),batch=[];
 for(const a of actions){
  if(a.kind==="REFUNDED"){
   batch.push(stmt(db,"UPDATE commerce_orders SET status='REFUNDED',refunded_at=COALESCE(refunded_at,?),revoked_at=COALESCE(revoked_at,?) WHERE paypal_order_id=?",time,time,a.id));
   batch.push(stmt(db,"UPDATE commerce_licenses SET status='REVOKED',revoked_at=COALESCE(revoked_at,?) WHERE paypal_order_id=?",time,a.id));
  }else if(a.kind==="HOLD"){
   batch.push(stmt(db,"UPDATE commerce_orders SET status='DISPUTED' WHERE paypal_order_id=? AND status!='REFUNDED'",a.id));
  }else continue;
  batch.push(stmt(db,"UPDATE commerce_download_grants SET revoked_at=COALESCE(revoked_at,?) WHERE license_id IN (SELECT license_id FROM commerce_licenses WHERE paypal_order_id=?)",time,a.id));
 }
 const status=matched?(actions.some(a=>a.kind==="HOLD")?"MANUAL_REVIEW":actions.some(a=>a.kind==="REFUNDED")?"REFUND_RECONCILED":"CAPTURE_VERIFIED"): "UNRELATED_ORDER";
 batch.push(stmt(db,"UPDATE commerce_webhook_inbox SET status=? WHERE event_id=? AND status='RECONCILE_REQUIRED'",status,event.id));
 await db.batch(batch);
 return {status};
}
