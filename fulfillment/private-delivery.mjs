/**
 * BruA1 private MP3/WAV entitlement engine — NOT DEPLOYED OR ROUTED.
 * Deliberately kept separate from the PayPal sandbox Worker.
 *
 * Requires a separately reviewed, production-only Worker with private R2
 * read binding + D1 schema, final signed license, verified payment, and
 * affirmative owner launch approval. No public API is exported here.
 *
 * API users MUST pass a decision from server-side fulfillmentDecision() after
 * fetching the order, verified gateway capture, product and acceptance from D1.
 * Untrusted browser JSON must never supply these fields or an R2 object key.
 */
import { FORMAT_BY_TIER } from "./core.mjs";

const HEADER = Object.freeze({
  "Cache-Control":"private, no-store",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "X-Frame-Options":"DENY"
});
const tokenRe=/^[a-f0-9]{64}$/;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
const makeToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const sha256=async raw=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw))));
const j=(message,status)=>Response.json({error:message},{status,headers:HEADER});
const allowedFormat=(tier,format)=>FORMAT_BY_TIER[tier]?.includes(format)===true;
const validConfig=config=>config?.enabled===true && config?.owner_signed_off===true &&
  config?.environment==="production" && config?.agreement_status==="LEGAL_APPROVED" &&
  config?.approved_terms_published===true && typeof config?.approved_terms_version==="string" &&
  config.approved_terms_version.startsWith("BRUA1-LEGAL-APPROVED-");

/**
 * Internal-only trusted server call; not an HTTP endpoint.
 * Only returns token and audit metadata; it never exposes R2 object keys.
 */
export async function issuePurchaseDownloadGrant({env,config,decision,licenseRecord,order,format,grantToken}) {
  if(!validConfig(config)||!env?.ORDERS_DB||!env?.INSTRUMENTAL_MASTERS)
    throw Error("Approved production fulfillment service not configured");
  if(!decision?.allowed || decision.product_id!==order?.product_id || decision.tier!==order?.license_tier)
    throw Error("Fully validated order, payment and acceptance decision required");
  if(!allowedFormat(order.license_tier,format))
    throw Error("Format not included in purchased license tier");
  if(!licenseRecord || licenseRecord.order_id!==order.paypal_order_id ||
    licenseRecord.product_id!==order.product_id || licenseRecord.tier!==order.license_tier ||
    licenseRecord.record_status!=="ISSUED_FROM_VERIFIED_ACCEPTANCE" ||
    licenseRecord.agreement_version!==config.approved_terms_version ||
    licenseRecord.legal_document_delivery_required!==true ||
    !licenseRecord.license_id)
    throw Error("Approved, immutable, payment-bound license record required");
  const asset=await env.ORDERS_DB.prepare(
    "SELECT product_id,format,r2_object_key,rights_cleared,independent_qa_pass,private_r2_qa_pass FROM commerce_audio_assets WHERE product_id = ? AND format = ?"
  ).bind(order.product_id,format).first();
  if(!asset || asset.rights_cleared!==1 || asset.independent_qa_pass!==1 ||
    asset.private_r2_qa_pass!==1 || typeof asset.r2_object_key!=="string" || !asset.r2_object_key)
    throw Error("Private audio asset has not passed all release gates");
  // Insertion only; does not serve or read the private asset.
  const token=grantToken??makeToken();
  if(!tokenRe.test(token))throw Error("Invalid server grant token");
  const tokenHash=await sha256(token);
  const expiry=Math.floor(Date.now()/1000)+900;
  if(grantToken){
    await env.ORDERS_DB.prepare(
      "INSERT INTO commerce_download_grants (token_hash,license_id,product_id,format,expires_at_epoch,max_downloads,download_count) SELECT ?,?,?,?,?,3,0 FROM commerce_orders o JOIN commerce_licenses l ON l.paypal_order_id=o.paypal_order_id WHERE o.paypal_order_id=? AND l.license_id=? AND o.status='COMPLETED' AND l.status='ISSUED' AND o.revoked_at IS NULL AND o.refunded_at IS NULL AND o.chargeback_at IS NULL ON CONFLICT(token_hash) DO NOTHING"
    ).bind(tokenHash,licenseRecord.license_id,order.product_id,format,expiry,order.paypal_order_id,licenseRecord.license_id).run();
    const saved=await env.ORDERS_DB.prepare("SELECT * FROM commerce_download_grants WHERE token_hash=?").bind(tokenHash).first();
    if(!saved||saved.license_id!==licenseRecord.license_id||saved.product_id!==order.product_id||saved.format!==format||saved.revoked_at||saved.expires_at_epoch<=Math.floor(Date.now()/1000)||saved.download_count>=saved.max_downloads)throw Error("Grant unavailable or exhausted");
    return Object.freeze({token,expires_at_epoch:saved.expires_at_epoch,max_downloads:saved.max_downloads,format,license_id:licenseRecord.license_id,delivery_mode:"PRIVATE_R2_PROXY",no_public_object_url:true});
  }
  await env.ORDERS_DB.prepare(
    "INSERT INTO commerce_download_grants (token_hash,license_id,product_id,format,expires_at_epoch,max_downloads,download_count) VALUES (?,?,?,?,?,3,0)"
  ).bind(tokenHash,licenseRecord.license_id,order.product_id,format,expiry).run();
  return Object.freeze({
    token,expires_at_epoch:expiry,max_downloads:3,format,license_id:licenseRecord.license_id,
    delivery_mode:"PRIVATE_R2_PROXY",no_public_object_url:true
  });
}

/**
 * Actual streaming service entry point for future separately deployed Worker.
 * Denies without final commerce approval, valid token, an active license/order,
 * and the exact private R2 asset for the purchased product and tier.
 */
export async function streamLicensedAudio({request,env,config}) {
  if(!validConfig(config)||!env?.ORDERS_DB||!env?.INSTRUMENTAL_MASTERS)
    return j("Commercial fulfillment is disabled",503);
  if(request.method!=="POST")return j("Method not allowed",405);
  const origin=request.headers.get("Origin");
  if(origin && origin!==config.allowed_origin)return j("Invalid origin",403);
  const auth=request.headers.get("Authorization")||"";
  const raw=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!tokenRe.test(raw))return j("Invalid download authorization",401);
  const h=await sha256(raw);
  try {
    const row=await env.ORDERS_DB.prepare(
      "SELECT g.token_hash,g.product_id,g.format,g.expires_at_epoch,g.max_downloads,g.download_count,g.revoked_at AS grant_revoked,"+
      "l.status AS license_status,l.revoked_at AS license_revoked,l.agreement_version,l.product_id AS license_product,l.tier AS license_tier,"+
      "o.status AS order_status,o.product_id AS order_product,o.refunded_at,o.chargeback_at,o.revoked_at AS order_revoked,"+
      "p.sale_enabled,a.r2_object_key,a.rights_cleared,a.independent_qa_pass,a.private_r2_qa_pass "+
      "FROM commerce_download_grants g "+
      "JOIN commerce_licenses l ON l.license_id=g.license_id "+
      "JOIN commerce_orders o ON o.paypal_order_id=l.paypal_order_id "+
      "JOIN commerce_products p ON p.product_id=g.product_id "+
      "JOIN commerce_audio_assets a ON a.product_id=g.product_id AND a.format=g.format "+
      "WHERE g.token_hash=?"
    ).bind(h).first();
    if(!row || row.grant_revoked || row.license_revoked || row.order_revoked || row.refunded_at || row.chargeback_at ||
      row.order_status!=="COMPLETED" || row.license_status!=="ISSUED" ||
      row.agreement_version!==config.approved_terms_version || row.sale_enabled!==1 ||
      row.product_id!==row.license_product || row.product_id!==row.order_product ||
      !allowedFormat(row.license_tier,row.format) ||
      row.rights_cleared!==1 || row.independent_qa_pass!==1 || row.private_r2_qa_pass!==1 ||
      !row.r2_object_key || !Number.isInteger(Number(row.expires_at_epoch)) ||
      Number(row.expires_at_epoch)<=Math.floor(Date.now()/1000) ||
      Number(row.max_downloads)<1 || Number(row.download_count)>=Number(row.max_downloads))
      return j("Download unavailable or expired",403);

    const media=await env.INSTRUMENTAL_MASTERS.get(row.r2_object_key);
    if(!media?.body || !media.size || media.size<1024)
      return j("Licensed file temporarily unavailable",503);
    // Atomic claim prevents parallel users sharing a 3-use link to exceed 3 uses.
    const changed=await env.ORDERS_DB.prepare(
      "UPDATE commerce_download_grants SET download_count=download_count+1 "+
      "WHERE token_hash=? AND revoked_at IS NULL AND expires_at_epoch>? AND download_count<max_downloads "+
      "AND EXISTS (SELECT 1 FROM commerce_licenses l JOIN commerce_orders o ON o.paypal_order_id=l.paypal_order_id "+
      "JOIN commerce_products p ON p.product_id=commerce_download_grants.product_id "+
      "JOIN commerce_audio_assets a ON a.product_id=commerce_download_grants.product_id AND a.format=commerce_download_grants.format "+
      "WHERE l.license_id=commerce_download_grants.license_id AND l.status='ISSUED' AND l.revoked_at IS NULL "+
      "AND l.agreement_version=? AND l.product_id=commerce_download_grants.product_id AND o.product_id=l.product_id "+
      "AND o.status='COMPLETED' AND o.refunded_at IS NULL AND o.chargeback_at IS NULL AND o.revoked_at IS NULL "+
      "AND o.license_tier=l.tier AND (commerce_download_grants.format='mp3' OR (commerce_download_grants.format='wav' AND l.tier IN ('premium','unlimited'))) "+
      "AND p.sale_enabled=1 AND p.rights_cleared=1 AND p.independent_qa_pass=1 "+
      "AND a.r2_object_key=? AND a.rights_cleared=1 AND a.independent_qa_pass=1 AND a.private_r2_qa_pass=1)"
    ).bind(h,Math.floor(Date.now()/1000),config.approved_terms_version,row.r2_object_key).run();
    if(changed?.meta?.changes!==1){
      media.body.cancel?.().catch(()=>{});
      return j("Download allowance exhausted",403);
    }
    // No public bucket URL, private R2 object key, or original storage path is returned.
    const ext=row.format==="wav"?"wav":"mp3";
    const contentType=ext==="wav"?"audio/wav":"audio/mpeg";
    const filename="BruA1_"+row.product_id+"_Licensed."+ext;
    return new Response(media.body,{status:200,headers:{
      ...HEADER,
      "Content-Type":contentType,
      "Content-Length":String(media.size),
      "Content-Disposition":'attachment; filename="'+filename+'"'
    }});
  }catch{
    return j("Private delivery temporarily unavailable",503);
  }
}
