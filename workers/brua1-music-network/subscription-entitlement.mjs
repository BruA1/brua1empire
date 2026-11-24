// Evaluate membership only from authenticated PayPal server readbacks, never browser data.
// Caller must obtain subscription and transaction history using the verified merchant's API.
const PRICES=Object.freeze({monthly:{amount:499,maxDays:32},annual:{amount:4999,maxDays:367}});
const ts=v=>Math.floor(Date.parse(v)/1000);
const money=(v,cents)=>v?.currency_code==="USD"&&/^\d+\.\d{2}$/.test(v.value||"")&&Math.round(Number(v.value)*100)===cents;
export function decideEntitlement({binding,subscription,transactions,prior,now}){
 if(!binding||!PRICES[binding.cycle]||!binding.subscriptionId||!binding.planId||!binding.memberId||!binding.customId||!Number.isSafeInteger(now))throw Error("Verified binding required");
 if(subscription?.id!==binding.subscriptionId||subscription.plan_id!==binding.planId||subscription.custom_id!==binding.customId||subscription.plan_overridden===true||String(subscription.quantity??"1")!=="1")throw Error("Subscription identity or plan mismatch");
 if(!Array.isArray(transactions))throw Error("Authenticated transaction list required");
 const plan=PRICES[binding.cycle],hold=(status,reason)=>({status,accessUntil:0,reason});
 if(prior?.manualHold)return hold("SUSPENDED","MANUAL_HOLD");
 const info=subscription.billing_info||{},last=ts(info.last_payment?.time);
 const paid=transactions.filter(t=>ts(t.time)===last&&money(t.amount_with_breakdown?.gross_amount,plan.amount));
 if(paid.some(t=>["REFUNDED","PARTIALLY_REFUNDED","REVERSED"].includes(t.status)))return hold("SUSPENDED","REFUND_REVIEW");
 if(["SUSPENDED","EXPIRED"].includes(subscription.status))return hold("SUSPENDED","PROVIDER_"+subscription.status);
 if(subscription.status==="CANCELLED"){
  // Cancellation stops renewals; preserve only an already recorded, still verified paid period.
  const prev=transactions.find(t=>t.id===prior?.transactionId);
  if(!prev||prev.status!=="COMPLETED"||!money(prev.amount_with_breakdown?.gross_amount,plan.amount)||!Number.isSafeInteger(prior?.accessUntil)||prior.accessUntil<=now)return hold("CANCELED","NO_VERIFIED_REMAINING_PERIOD");
  return {status:"CANCELED",accessUntil:prior.accessUntil,transactionId:prev.id,reason:"PAID_PERIOD_REMAINS"};
 }
 if(subscription.status!=="ACTIVE")return hold("PAST_DUE","NOT_ACTIVE");
 if(info.failed_payments_count!==0||!money(info.outstanding_balance,0))return hold("PAST_DUE","PAYMENT_OUTSTANDING");
 if(!Number.isSafeInteger(last)||last>now+60||!money(info.last_payment?.amount,plan.amount)||paid.length!==1||paid[0].status!=="COMPLETED"||!paid[0].id)return hold("PAST_DUE","NO_MATCHING_COMPLETED_PAYMENT");
 const next=ts(info.next_billing_time);
 if(!Number.isSafeInteger(next)||next<=now||next<=last||next-last>plan.maxDays*86400)return hold("PAST_DUE","PAID_PERIOD_UNVERIFIED");
 if(prior?.transactionId===paid[0].id&&Number.isSafeInteger(prior.accessUntil)&&next>prior.accessUntil)return hold("SUSPENDED","SAME_PAYMENT_CANNOT_EXTEND_PERIOD");
 return {status:"ACTIVE",accessUntil:next,transactionId:paid[0].id,reason:"VERIFIED_PAID_PERIOD"};
}
