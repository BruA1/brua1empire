/**
 * BruA1 dedicated LIVE PayPal checkout identity holder — PRELAUNCH LOCK.
 *
 * This Worker deliberately cannot take real-money payments or deliver masters.
 * It is separate from the operational brua1-checkout-sandbox Worker.
 * Live credentials must ONLY be entered through Cloudflare encrypted Worker
 * secrets; never GitHub repository contents or a browser chat.
 *
 * This is a credential-configuration destination, NOT a checkout release.
 * The handler must be replaced by independently QA-approved production code
 * before any purchase endpoints can be enabled.
 */
const DEFAULT_HEADERS = Object.freeze({
  "Cache-Control":"no-store",
  "Content-Type":"application/json; charset=utf-8",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "X-Frame-Options":"DENY",
  "Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'",
});
function respond(status,data) {
  return new Response(JSON.stringify(data),{status,headers:DEFAULT_HEADERS});
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if(request.method==="GET" && url.pathname==="/health") {
      return respond(200,{
        service:"brua1-checkout-production",
        status:"PRELAUNCH_LOCKED",
        livePayments:false,
        paymentCaptureEnabled:false,
        licenseIssuanceEnabled:false,
        realAudioDeliveryEnabled:false,
        sandboxUnaffected:true
      });
    }
    if(url.pathname.startsWith("/api/") || url.pathname.startsWith("/checkout")) {
      return respond(503,{error:"BruA1 live checkout is not yet enabled."});
    }
    return respond(404,{error:"Not found"});
  }
};
