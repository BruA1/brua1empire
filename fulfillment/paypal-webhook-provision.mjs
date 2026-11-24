// Owner-authorized live webhook subscription. No orders, captures or refunds.
const BASE="https://api-m.paypal.com";
const URL="https://brua1-checkout-production.a1productions0527.workers.dev/api/paypal/webhook";
const EVENTS=["PAYMENT.CAPTURE.COMPLETED","PAYMENT.CAPTURE.REFUNDED","PAYMENT.CAPTURE.REVERSED","CUSTOMER.DISPUTE.CREATED"];
function matches(w){return w?.url===URL&&/^[A-Z0-9]{8,50}$/.test(w?.id||"")&&EVENTS.every(n=>w.event_types?.some(t=>t.name===n));}
export async function provisionWebhook(env,transport=fetch){
 if(env.PAYPAL_ENVIRONMENT!=="live"||env.LIVE_CHECKOUT_ENABLED!=="false"||env.CHECKOUT_ROUTES_ENABLED!=="false"||env.REAL_AUDIO_DELIVERY_ENABLED!=="false")throw Error("Checkout lock required");
 const auth=await transport(BASE+"/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET),"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
 if(!auth.ok)throw Error("OAuth failed");
 const {access_token}=await auth.json();if(!access_token)throw Error("Missing token");
 const headers={Authorization:"Bearer "+access_token,"Content-Type":"application/json"};
 const list=await transport(BASE+"/v1/notifications/webhooks",{headers});if(!list.ok)throw Error("Webhook listing failed");
 const data=await list.json();if(!Array.isArray(data.webhooks))throw Error("Invalid webhook listing");
 const found=data.webhooks.filter(w=>w.url===URL);
 if(found.length>1)throw Error("Duplicate webhook subscriptions");
 let result=found[0];
 if(result&&!matches(result))throw Error("Existing webhook differs; operator review required");
 if(!result){
  const created=await transport(BASE+"/v1/notifications/webhooks",{method:"POST",headers,body:JSON.stringify({url:URL,event_types:EVENTS.map(name=>({name}))})});
  if(!created.ok)throw Error("Webhook registration rejected");
  result=await created.json();
 }
 if(!matches(result))throw Error("Webhook response mismatch");
 const readback=await transport(BASE+"/v1/notifications/webhooks/"+result.id,{headers});
 if(!readback.ok)throw Error("Webhook verification failed");
 if(!matches(await readback.json()))throw Error("Webhook readback mismatch");
 return {verified:true,webhookId:result.id,registeredEvents:EVENTS.length,paymentsEnabled:false};
}
