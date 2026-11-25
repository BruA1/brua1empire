// Free founding cohort. No PayPal, email, card collection or automatic conversion.
export const BETA_TERMS="BRUA1-FOUNDING-BETA-V1";
export const BETA_LIMIT=50;
export const BETA_REVIEW=25;
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");
const hash=async x=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(x))));
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const stmt=(db,sql,...a)=>db.prepare(sql).bind(...a);
const first=(db,sql,...a)=>stmt(db,sql,...a).first();
export function betaOpen(env){return env.NETWORK_MEMBER_API_ENABLED==="true"&&env.NETWORK_PUBLIC_BETA_ENABLED==="true"&&env.NETWORK_BILLING_ENABLED!=="true"&&env.NETWORK_BETA_MODERATION_READY==="true"&&typeof env.TURNSTILE_SECRET_KEY==="string"&&env.TURNSTILE_SECRET_KEY.length>0&&typeof env.TURNSTILE_SITE_KEY==="string"&&/^[A-Za-z0-9_-]{10,100}$/.test(env.TURNSTILE_SITE_KEY);}
export async function betaStats(db,now){
 const r=await first(db,"SELECT COUNT(*) AS registered,COALESCE(SUM(CASE WHEN m.status='ACTIVE' AND s.status='TRIAL' AND s.access_until>? THEN 1 ELSE 0 END),0) AS active,COALESCE(SUM(CASE WHEN m.status='ACTIVE' AND s.status='TRIAL' AND s.access_until>? AND p.directory_visible=1 AND (EXISTS(SELECT 1 FROM network_roles r WHERE r.member_id=m.id) OR EXISTS(SELECT 1 FROM network_service_roles r WHERE r.member_id=m.id AND r.role IN ('carpenter','contractor')) OR EXISTS(SELECT 1 FROM network_focused_roles r WHERE r.member_id=m.id)) THEN 1 ELSE 0 END),0) AS listed FROM network_founding_members f JOIN network_members m ON m.id=f.member_id LEFT JOIN network_memberships s ON s.member_id=m.id LEFT JOIN network_profiles p ON p.member_id=m.id",now,now);
 return {registered:r.registered,active:r.active,listed:r.listed,limit:BETA_LIMIT,reviewAt:BETA_REVIEW,reviewDue:r.registered>=BETA_REVIEW,spotsRemaining:Math.max(0,BETA_LIMIT-r.registered)};
}
export async function verifyTurnstile(env,token,transport=fetch){
 if(typeof token!=="string"||!token||token.length>2048)return false;
 const res=await transport("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token})});
 if(!res.ok)return false;
 const result=await res.json();
 return result.success===true&&result.hostname==="brua1.com"&&result.action==="founding_signup";
}
export async function registerFounder(db,input,now){
 const name=typeof input.displayName==="string"?input.displayName.trim():"";
 if(!name||name.length>80||input.acceptedTerms!==true||input.adultConfirmed!==true||input.termsVersion!==BETA_TERMS)throw Error("Name, age and beta terms required");
 const id=crypto.randomUUID(),accessKey=random(),sessionToken=random(),keyHash=await hash(accessKey),sessionHash=await hash(sessionToken),expiresAt=now+12*3600;
 // D1 batch is atomic: cap counts historical registrations, not simultaneous
 // sessions or public listings. Later steps only run if this new member exists.
 const results=await db.batch([
  stmt(db,"INSERT INTO network_members(id,display_name,status,created_at) SELECT ?,?,'ACTIVE',? WHERE (SELECT COUNT(*) FROM network_founding_members)<?",id,name,now,BETA_LIMIT),
  stmt(db,"INSERT INTO network_founding_members(member_id,terms_version,accepted_at) SELECT id,?,? FROM network_members WHERE id=?",BETA_TERMS,now,id),
  stmt(db,"INSERT INTO network_login_keys(key_hash,member_id,created_at) SELECT ?,id,? FROM network_members WHERE id=?",keyHash,now,id),
  stmt(db,"INSERT INTO network_sessions(token_hash,member_id,expires_at) SELECT ?,id,? FROM network_members WHERE id=?",sessionHash,expiresAt,id),
  stmt(db,"INSERT INTO network_memberships(member_id,provider_subscription_id,status,access_until,updated_at) SELECT id,NULL,'TRIAL',4102444800,? FROM network_members WHERE id=?",now,id)
 ]);
 if(results[0]?.meta?.changes!==1)return null;
 if(results.some(r=>r.meta?.changes!==1))throw Error("Account creation incomplete");
 return {accessKey,sessionToken,expiresAt,freeBeta:true};
}
