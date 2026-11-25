import {EXPECTED_PRICE_CENTS} from "../../fulfillment/paypal-payment-gates.mjs";

// Quote-only, not a checkout authorization. Never accept a client price,
// coupon, member ID or discount rate. No payment operation is performed.
export const MEMBER_DISCOUNT_BPS=1500;
export const MEMBER_PRICING_VERSION="BRUA1-MEMBER-15-V1";
export function memberPricePreview(tier,paid){
 if(!Object.hasOwn(EXPECTED_PRICE_CENTS,tier))throw Error("Unknown standard license tier");
 const regularCents=EXPECTED_PRICE_CENTS[tier];
 const discountBps=paid===true?MEMBER_DISCOUNT_BPS:0;
 const subtotalCents=Math.floor((regularCents*(10000-discountBps)+5000)/10000);
 return {tier,regularCents,discountCents:regularCents-subtotalCents,subtotalCents,discountBps,currency:"USD",pricingVersion:MEMBER_PRICING_VERSION,taxIncluded:false,checkoutAuthorized:false};
}
export async function verifiedMemberPricing(db,memberId,now){
 // Match the verified payment ledger to the same provider subscription and
 // enrollment; exclude trials, missing transactions, holds, expiry, unpaid
 // or suspended accounts. Never expose provider IDs or transaction details.
 const paid=await db.prepare("SELECT 1 AS paid FROM network_members m JOIN network_memberships sub ON sub.member_id=m.id JOIN network_subscription_ledger l ON l.member_id=m.id AND l.provider_subscription_id=sub.provider_subscription_id JOIN network_enrollments e ON e.member_id=m.id AND e.provider_subscription_id=sub.provider_subscription_id JOIN network_billing_plans p ON p.cycle=e.cycle AND p.provider_plan_id=e.provider_plan_id WHERE m.id=? AND m.status='ACTIVE' AND sub.status IN ('ACTIVE','CANCELED') AND sub.access_until>? AND l.access_until=sub.access_until AND l.manual_hold=0 AND l.transaction_id IS NOT NULL AND length(l.transaction_id)>0 AND e.status='BOUND' AND p.cycle IN ('monthly','annual') AND p.currency='USD' AND ((p.cycle='monthly' AND p.price_cents=499) OR (p.cycle='annual' AND p.price_cents=4999))").bind(memberId,now).first();
 return {eligible:paid?.paid===1,checkedAtEpoch:now,prices:Object.keys(EXPECTED_PRICE_CENTS).map(t=>memberPricePreview(t,paid?.paid===1)),checkoutAuthorized:false};
}
