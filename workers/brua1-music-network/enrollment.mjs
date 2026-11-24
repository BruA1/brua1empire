import {decideEntitlement} from "./subscription-entitlement.mjs";
const stmt=(db,sql,...p)=>db.prepare(sql).bind(...p);
const first=(db,sql,...p)=>stmt(db,sql,...p).first();
const planRE=/^P-[A-Z0-9]{24}$/;
const subRE=/^I-[A-Z0-9]{8,32}$/;
const ids=()=>crypto.randomUUID();
const expected={monthly:499,annual:4999};
function safeApproval(url){
 const u=new URL(url);
 if(u.protocol!=="https:"||u.hostname!=="www.paypal.com"||u.username||u.password||u.port||u.pathname!=="/webapps/billing/subscriptions")throw Error("Unexpected provider approval URL");
 return u.href;
}
// Broker is a trusted server-side capability, never a client-supplied URL.
export async function beginEnrollment(db,broker,memberId,input,termsVersion,now){
 if(!Object.hasOwn(expected,input.cycle)||input.acceptedTerms!==true||input.termsVersion!==termsVersion||!termsVersion)throw Error("Membership terms acceptance required");
 const plan=await first(db,"SELECT * FROM network_billing_plans WHERE cycle=? AND enrollment_enabled=1",input.cycle);
 if(!plan||plan.currency!=="USD"||plan.price_cents!==expected[input.cycle]||!planRE.test(plan.provider_plan_id))throw Error("Plan not open");
 const existingMembership=await first(db,"SELECT status,access_until FROM network_memberships WHERE member_id=?",memberId);
 if(existingMembership&&existingMembership.access_until>now)throw Error("Existing membership");
 const id=ids(),custom=ids();
 await stmt(db,"INSERT INTO network_enrollments(id,member_id,cycle,provider_plan_id,custom_id,terms_version,created_at,status) VALUES(?,?,?,?,?,?,?,'PENDING') ON CONFLICT(member_id) DO NOTHING",id,memberId,input.cycle,plan.provider_plan_id,custom,termsVersion,now).run();
 const row=await first(db,"SELECT * FROM network_enrollments WHERE member_id=?",memberId);
 if(row.cycle!==input.cycle||row.terms_version!==termsVersion||row.provider_plan_id!==plan.provider_plan_id||!["PENDING","APPROVAL_PENDING"].includes(row.status))throw Error("Existing enrollment requires review");
 if(row.provider_subscription_id&&row.approval_url)return {approvalUrl:safeApproval(row.approval_url),status:"APPROVAL_PENDING"};
 // Stable provider idempotency ID. Do not retry indefinitely after provider idempotency window.
 if(now-row.created_at>3600)throw Error("Enrollment expired; review required");
 const result=await broker.createSubscription({planId:row.provider_plan_id,customId:row.custom_id,requestId:row.id});
 if(!subRE.test(result.id||"")||result.plan_id!==row.provider_plan_id||result.custom_id!==row.custom_id||result.status!=="APPROVAL_PENDING")throw Error("Unexpected provider subscription");
 const approval=safeApproval(result.links?.find(l=>l.rel==="approve")?.href||"");
 const write=await stmt(db,"UPDATE network_enrollments SET provider_subscription_id=?,approval_url=?,status='APPROVAL_PENDING' WHERE id=? AND status='PENDING' AND provider_subscription_id IS NULL",result.id,approval,row.id).run();
 if(write.meta?.changes!==1){const old=await first(db,"SELECT provider_subscription_id FROM network_enrollments WHERE id=?",row.id);if(old?.provider_subscription_id!==result.id)throw Error("Enrollment conflict");}
 return {approvalUrl:approval,status:"APPROVAL_PENDING"};
}
export async function refreshEnrollment(db,broker,memberId,now){
 const row=await first(db,"SELECT * FROM network_enrollments WHERE member_id=? AND provider_subscription_id IS NOT NULL",memberId);
 if(!row)throw Error("Enrollment not found");
 const binding={memberId,cycle:row.cycle,subscriptionId:row.provider_subscription_id,planId:row.provider_plan_id,customId:row.custom_id};
 await stmt(db,"INSERT INTO network_subscription_ledger(member_id,provider_subscription_id,access_until,updated_at) VALUES(?,?,0,?) ON CONFLICT(member_id) DO NOTHING",memberId,binding.subscriptionId,now).run();
 const before=await first(db,"SELECT * FROM network_subscription_ledger WHERE member_id=?",memberId);
 if(before.provider_subscription_id!==binding.subscriptionId)throw Error("Subscription conflict");
 const data=await broker.readSubscription({subscriptionId:binding.subscriptionId});
 const d=decideEntitlement({binding,subscription:data.subscription,transactions:data.transactions,prior:{transactionId:before.transaction_id,accessUntil:before.access_until,manualHold:!!before.manual_hold},now});
 // Serialize readbacks: stale or concurrent reconciliation cannot overwrite new state.
 const revision=before.revision+1;
 const results=await db.batch([
  stmt(db,"UPDATE network_subscription_ledger SET transaction_id=?,access_until=?,revision=?,updated_at=? WHERE member_id=? AND revision=? AND manual_hold=? AND provider_subscription_id=?",d.transactionId||before.transaction_id,d.accessUntil,revision,now,memberId,before.revision,before.manual_hold,binding.subscriptionId),
  stmt(db,"INSERT INTO network_memberships(member_id,provider_subscription_id,status,access_until,updated_at) SELECT member_id,provider_subscription_id,?,?,? FROM network_subscription_ledger WHERE member_id=? AND revision=? AND updated_at=? AND access_until=? AND manual_hold=? ON CONFLICT(member_id) DO UPDATE SET provider_subscription_id=excluded.provider_subscription_id,status=excluded.status,access_until=excluded.access_until,updated_at=excluded.updated_at WHERE network_memberships.provider_subscription_id IS NULL OR network_memberships.provider_subscription_id=excluded.provider_subscription_id",d.status,d.accessUntil,now,memberId,revision,now,d.accessUntil,before.manual_hold),
  stmt(db,"UPDATE network_enrollments SET status='BOUND' WHERE id=? AND EXISTS(SELECT 1 FROM network_memberships WHERE member_id=? AND provider_subscription_id=?)",row.id,memberId,binding.subscriptionId)
 ]);
 if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)throw Error("Concurrent or conflicting membership refresh");
 return {status:d.status,accessUntil:d.accessUntil};
}
