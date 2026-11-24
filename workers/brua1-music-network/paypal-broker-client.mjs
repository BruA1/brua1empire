// Cloudflare service binding, not browser-supplied transport.
export function networkBroker(env){
 if(!env.NETWORK_PAYPAL_SERVICE||!/^[a-f0-9]{64}$/.test(env.NETWORK_BROKER_KEY||""))throw Error("Provider broker not configured");
 async function call(action,fields){
  const r=await env.NETWORK_PAYPAL_SERVICE.fetch("https://internal.invalid/internal/network-billing",{method:"POST",headers:{"Content-Type":"application/json","X-Network-Broker-Key":env.NETWORK_BROKER_KEY},body:JSON.stringify({...fields,action})});
  if(!r.ok)throw Error("Provider operation unavailable");return r.json();
 }
 return {createSubscription:x=>call("create",x),readSubscription:x=>call("read",x),cancelSubscription:x=>call("cancel",x)};
}