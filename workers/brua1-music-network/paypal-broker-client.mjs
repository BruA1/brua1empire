// Cloudflare service binding, not browser-supplied transport.
export function networkBroker(env){
 if(!env.NETWORK_PAYPAL_SERVICE||!/^[a-f0-9]{64}$/.test(env.NETWORK_BROKER_KEY||""))throw Error("Provider broker not configured");
 async function call(action,fields){
  const r=await env.NETWORK_PAYPAL_SERVICE.fetch("https://internal.invalid/internal/network-billing",{method:"POST",headers:{"Content-Type":"application/json","X-Network-Broker-Key":env.NETWORK_BROKER_KEY},body:JSON.stringify({...fields,action})});
  if(!r.ok)throw Error("Provider operation unavailable");return r.json();
 }
 async function readiness(){
  const r=await env.NETWORK_PAYPAL_SERVICE.fetch("https://internal.invalid/internal/network-billing",{method:"POST",headers:{"X-Network-Broker-Key":env.NETWORK_BROKER_KEY,"X-Network-Broker-Probe":"readiness"}});
  if(!r.ok)throw Error("Provider bridge unavailable");
  const data=await r.json();if(data.authenticated!==true)throw Error("Provider bridge unavailable");
  return data;
 }
 return {readiness,createSubscription:x=>call("create",x),readSubscription:x=>call("read",x),cancelSubscription:x=>call("cancel",x)};
}