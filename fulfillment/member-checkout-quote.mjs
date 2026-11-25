// Staged checkout quote. No public checkout authorization or tax assumption.
export const MEMBER_RATE_VERSION="BRUA1-MEMBER-15-V1";
const canonical=Object.freeze({basic:2999,premium:5999,unlimited:9999});
const tokenRE=/^[a-f0-9]{64}$/;
export function memberSubtotal(tier){
 if(!Object.hasOwn(canonical,tier))throw Error("Invalid tier");
 return Math.floor((canonical[tier]*8500+5000)/10000);
}
export function validMemberQuote(q,tier,productId){
 return !!q&&Object.hasOwn(canonical,tier)&&q.product_id===productId&&q.tier===tier&&q.regular_cents===canonical[tier]&&q.discount_bps===1500&&q.subtotal_cents===memberSubtotal(tier)&&q.discount_cents===q.regular_cents-q.subtotal_cents&&q.currency==="USD"&&q.pricing_version===MEMBER_RATE_VERSION&&q.tax_cents===0&&Number.isSafeInteger(q.checked_at_epoch)&&tokenRE.test(q.member_session_hash||"");
}
export async function quoteForMember(env,tier,productId,memberToken,now=Math.floor(Date.now()/1000)){
 if(!tokenRE.test(memberToken||"")||env.MEMBER_BEAT_DISCOUNT_ENABLED!=="true"||env.MEMBER_DISCOUNT_TAX_MODE!=="VERIFIED_NO_ADDITIONAL_TAX_USD"||!env.NETWORK_PRICING_SERVICE)throw Error("Member pricing unavailable");
 const res=await env.NETWORK_PRICING_SERVICE.fetch("https://network.internal/api/network/beat-pricing",{method:"GET",headers:{Origin:"https://brua1.com",Authorization:"Bearer "+memberToken}});
 if(!res.ok)throw Error("Member entitlement unavailable");
 const data=await res.json(),price=data.prices?.find(p=>p.tier===tier);
 if(data.eligible!==true||!Number.isSafeInteger(data.checkedAtEpoch)||Math.abs(now-data.checkedAtEpoch)>60||price?.discountBps!==1500||price.pricingVersion!==MEMBER_RATE_VERSION||price.currency!=="USD"||price.regularCents!==canonical[tier]||price.subtotalCents!==memberSubtotal(tier)||price.discountCents!==price.regularCents-price.subtotalCents||price.taxIncluded!==false)throw Error("Member pricing not verified");
 const member_session_hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(memberToken))),x=>x.toString(16).padStart(2,"0")).join("");
 const q={product_id:productId,tier,regular_cents:price.regularCents,discount_bps:1500,subtotal_cents:price.subtotalCents,discount_cents:price.discountCents,tax_cents:0,currency:"USD",pricing_version:MEMBER_RATE_VERSION,checked_at_epoch:data.checkedAtEpoch,member_session_hash};
 if(!validMemberQuote(q,tier,productId))throw Error("Invalid member quote");
 return q;
}
const stmt=(db,sql,...a)=>db.prepare(sql).bind(...a);
export async function readMemberQuote(db,sessionId){
 // Backwards compatible with existing full-price production databases until
 // the additive migration is separately reviewed and applied.
 const table=await stmt(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='commerce_member_checkout_quotes'").first();
 if(!table)return null;
 return (await stmt(db,"SELECT * FROM commerce_member_checkout_quotes WHERE session_id=?",sessionId).first())||null;
}
export async function readOrderMemberQuote(db,order){
 if(!Object.hasOwn(canonical,order.license_tier)||Number(order.amount_cents)===canonical[order.license_tier])return null;
 const row=await stmt(db,"SELECT q.* FROM commerce_member_checkout_quotes q JOIN commerce_checkout_sessions s ON s.session_id=q.session_id WHERE s.paypal_order_id=? AND s.product_id=q.product_id AND s.tier=q.tier",order.paypal_order_id).first();
 if(!validMemberQuote(row,order.license_tier,order.product_id)||row.subtotal_cents!==Number(order.amount_cents))throw Error("Discount order lacks verified immutable quote");
 return row;
}
