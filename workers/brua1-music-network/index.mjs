import {networkBroker} from "./paypal-broker-client.mjs";
import {beginEnrollment,refreshEnrollment} from "./enrollment.mjs";
import {redeemInvite,login,logout} from "./auth.mjs";
// Isolated community API; invite authentication and member features remain locked by default.
const ORIGIN="https://brua1.com";
const ROLES=new Set(["musician","vocalist","producer","songwriter","ghostwriter","audio_engineer","dj","recording_studio","video_creator","artist"]);
const tokenRE=/^[a-f0-9]{64}$/;
const idRE=/^[A-Za-z0-9-]{1,80}$/;
const epoch=()=>Math.floor(Date.now()/1000);
const stmt=(db,sql,...p)=>db.prepare(sql).bind(...p);
const first=(db,sql,...p)=>stmt(db,sql,...p).first();
const all=async(db,sql,...p)=>(await stmt(db,sql,...p).all()).results;
const sha256=async t=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t))),b=>b.toString(16).padStart(2,"0")).join("");
const bounded=(x,n,required=false)=>{if(typeof x!=="string"||x.length>n||(required&&!x.trim()))throw Error("Invalid text");return x.trim();};
const active="m.status='ACTIVE' AND sub.status IN ('ACTIVE','TRIAL','CANCELED') AND sub.access_until>?";
async function signedIn(request,db,now){
 const token=(request.headers.get("Authorization")||"").replace(/^Bearer /,"");
 if(!tokenRE.test(token))return null;
 return first(db,"SELECT m.id,m.display_name FROM network_sessions s JOIN network_members m ON m.id=s.member_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND m.status='ACTIVE'",await sha256(token),now);
}
async function member(request,db,now){
 const token=(request.headers.get("Authorization")||"").replace(/^Bearer /,"");
 if(!tokenRE.test(token))return null;
 return first(db,"SELECT m.id,m.display_name FROM network_sessions s JOIN network_members m ON m.id=s.member_id JOIN network_memberships sub ON sub.member_id=m.id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND "+active,await sha256(token),now,now);
}
function response(status,data,cors=true){return Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",...(cors?{"Access-Control-Allow-Origin":ORIGIN,"Vary":"Origin"}:{})}})}
async function json(request){
 if(!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))throw Error("JSON required");
 const reader=request.body?.getReader();if(!reader)throw Error("Body required");let total=0;const chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>8192){await reader.cancel();throw Error("Too large")}chunks.push(value);}
 const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Object required");return value;
}
const visibility=" AND NOT EXISTS (SELECT 1 FROM network_blocks b WHERE (b.blocker_id=? AND b.blocked_id=m.id) OR (b.blocked_id=? AND b.blocker_id=m.id))";
async function channel(db,id,kind){if(!idRE.test(id||""))throw Error("Invalid channel");const row=await first(db,"SELECT id FROM network_channels WHERE id=? AND kind=? AND enabled=1",id,kind);if(!row)throw Error("Unknown channel");}
export async function networkRoute(request,env){
 const url=new URL(request.url),p=url.pathname,origin=request.headers.get("Origin");
 if(url.protocol==="https:"&&p==="/health"&&request.method==="GET"){
  try{
   const locked=env.NETWORK_MEMBER_API_ENABLED!=="true"&&env.NETWORK_INVITE_AUTH_ENABLED!=="true"&&env.NETWORK_BILLING_ENABLED!=="true";
   const info=await env.NETWORK_DB?.prepare("SELECT COUNT(*) AS n FROM network_channels").first();
   return response(info?.n===10?200:503,{service:"brua1-music-network",databaseReady:info?.n===10,memberApiEnabled:env.NETWORK_MEMBER_API_ENABLED==="true",inviteAuthEnabled:env.NETWORK_INVITE_AUTH_ENABLED==="true",billingEnabled:env.NETWORK_BILLING_ENABLED==="true",locked},origin===ORIGIN);
  }catch{return response(503,{service:"brua1-music-network",databaseReady:false},false)}
 }
 if(url.protocol!=="https:"||origin!==ORIGIN)return response(403,{error:"Origin not allowed"},false);
 if(env.NETWORK_MEMBER_API_ENABLED!=="true"||!env.NETWORK_DB)return response(503,{error:"Memberships are not open yet"});
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Authorization, Content-Type","Vary":"Origin"}});
 const db=env.NETWORK_DB,now=epoch();
 try{
 if(p.startsWith("/api/network/auth/")){
  if(env.NETWORK_INVITE_AUTH_ENABLED!=="true"||request.method!=="POST")return response(503,{error:"Invitation registration is closed"});
  if(p==="/api/network/auth/logout"){await logout(db,(request.headers.get("Authorization")||"").replace(/^Bearer /,""),now);return response(200,{loggedOut:true});}
  const x=await json(request);
  const result=p==="/api/network/auth/redeem"?await redeemInvite(db,x.invite,now):p==="/api/network/auth/login"?await login(db,x.accessKey,now):null;
  return result?response(200,result):response(401,{error:"Invalid or unavailable access key"});
 }
 if(p==="/api/network/billing/config"&&request.method==="GET"){if(env.NETWORK_BILLING_ENABLED!=="true"||!env.NETWORK_TERMS_VERSION||!env.NETWORK_PAYPAL_SERVICE)return response(503,{error:"Enrollment closed"});const rows=await all(db,"SELECT cycle,price_cents,currency FROM network_billing_plans WHERE enrollment_enabled=1");return response(200,{termsVersion:env.NETWORK_TERMS_VERSION,plans:rows,termsUrl:"https://brua1.com/membership-terms.html"});}
 if(p.startsWith("/api/network/billing/")){
  if(env.NETWORK_BILLING_ENABLED!=="true"||!env.NETWORK_PAYPAL_SERVICE||!env.NETWORK_TERMS_VERSION)return response(503,{error:"Subscription enrollment is closed"});
  const account=await signedIn(request,db,now);if(!account)return response(401,{error:"Sign in required"});
  if(request.method!=="POST")return response(405,{error:"POST required"});
  const x=await json(request);
  if(p==="/api/network/billing/begin")return response(200,await beginEnrollment(db,networkBroker(env),account.id,x,env.NETWORK_TERMS_VERSION,now));
  if(p==="/api/network/billing/refresh")return response(200,await refreshEnrollment(db,networkBroker(env),account.id,now));
  return response(404,{error:"Not found"});
 }
 const who=await member(request,db,now);if(!who)return response(401,{error:"Active membership required"});
 const get=request.method==="GET",post=request.method==="POST";
 if(p==="/api/network/me"&&get)return response(200,{member:who});
 if(p==="/api/network/channels"&&get)return response(200,{channels:await all(db,"SELECT id,title,kind FROM network_channels WHERE enabled=1 ORDER BY title")});
 if(p==="/api/network/directory"&&get){
  const q=bounded(url.searchParams.get("q")||"",100).toLowerCase(),role=url.searchParams.get("role")||"";
  if(role&&!ROLES.has(role))throw Error("Invalid role");
  const rows=await all(db,"SELECT p.member_id,p.display_name,p.bio,p.location,p.genres,p.instruments,p.portfolio_url,p.available,(SELECT group_concat(role) FROM network_roles WHERE member_id=m.id) AS roles FROM network_profiles p JOIN network_members m ON m.id=p.member_id JOIN network_memberships sub ON sub.member_id=m.id WHERE p.directory_visible=1 AND "+active+visibility+" AND (?='' OR EXISTS(SELECT 1 FROM network_roles r WHERE r.member_id=m.id AND r.role=?)) AND (?='' OR instr(lower(p.display_name||' '||p.bio||' '||p.location||' '||p.genres||' '||p.instruments),?)>0) ORDER BY p.display_name LIMIT 50",now,who.id,who.id,role,role,q,q);
  return response(200,{profiles:rows});
 }
 if(p==="/api/network/profile"&&post){
  const x=await json(request),name=bounded(x.displayName,80,true),bio=bounded(x.bio||"",1000),location=bounded(x.location||"",100),genres=bounded(x.genres||"",200),instruments=bounded(x.instruments||"",200),portfolio=bounded(x.portfolioUrl||"",300);
  if(portfolio){const u=new URL(portfolio);if(u.protocol!=="https:"||u.username||u.password)throw Error("Invalid portfolio URL");}
  const roles=[...new Set(Array.isArray(x.roles)?x.roles:[])];if(roles.length>10||roles.some(r=>!ROLES.has(r)))throw Error("Invalid roles");
  if(typeof x.directoryVisible!=="boolean"||typeof x.available!=="boolean")throw Error("Visibility required");
  await db.batch([stmt(db,"UPDATE network_members SET display_name=? WHERE id=?",name,who.id),stmt(db,"INSERT INTO network_profiles(member_id,display_name,bio,location,genres,instruments,portfolio_url,available,directory_visible) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET display_name=excluded.display_name,bio=excluded.bio,location=excluded.location,genres=excluded.genres,instruments=excluded.instruments,portfolio_url=excluded.portfolio_url,available=excluded.available,directory_visible=excluded.directory_visible",who.id,name,bio,location,genres,instruments,portfolio,+x.available,+x.directoryVisible),stmt(db,"DELETE FROM network_roles WHERE member_id=?",who.id),...roles.map(r=>stmt(db,"INSERT INTO network_roles VALUES(?,?)",who.id,r))]);return response(200,{saved:true});
 }
 if(p==="/api/network/chat"&&get){
  const id=url.searchParams.get("channel");await channel(db,id,"chat");
  const messages=await all(db,"SELECT c.id,c.author_id,m.display_name,c.body,c.created_at FROM network_chat_messages c JOIN network_members m ON m.id=c.author_id WHERE c.channel_id=? AND c.hidden=0 AND m.status='ACTIVE'"+visibility+" ORDER BY c.created_at DESC,c.id DESC LIMIT 50",id,who.id,who.id);
  return response(200,{messages:messages.reverse()});
 }
 if(p==="/api/network/chat"&&post){
  const x=await json(request),body=bounded(x.body,2000,true);await channel(db,x.channel,"chat");
  const id=crypto.randomUUID();const result=await stmt(db,"INSERT INTO network_chat_messages(id,channel_id,author_id,body,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM network_chat_messages WHERE author_id=? AND created_at>?)<10 AND EXISTS(SELECT 1 FROM network_members m JOIN network_memberships sub ON sub.member_id=m.id WHERE m.id=? AND "+active+")",id,x.channel,who.id,body,now,who.id,now-60,who.id,now).run();
  if(result.meta?.changes!==1)return response(429,{error:"Posting temporarily limited"});return response(201,{id});
 }
 if(p==="/api/network/threads"&&get){
  const id=url.searchParams.get("channel");await channel(db,id,"forum");
  return response(200,{threads:await all(db,"SELECT t.id,t.title,t.author_id,m.display_name,t.created_at FROM network_threads t JOIN network_members m ON m.id=t.author_id WHERE t.channel_id=? AND t.hidden=0 AND m.status='ACTIVE'"+visibility+" ORDER BY t.created_at DESC LIMIT 50",id,who.id,who.id)});
 }
 if(p==="/api/network/threads"&&post){
  const x=await json(request),title=bounded(x.title,140,true),body=bounded(x.body,4000,true);await channel(db,x.channel,"forum");
  if((await first(db,"SELECT COUNT(*) AS n FROM network_threads WHERE author_id=? AND created_at>?",who.id,now-60)).n>=5)return response(429,{error:"Posting temporarily limited"});
  const id=crypto.randomUUID();await db.batch([stmt(db,"INSERT INTO network_threads(id,channel_id,author_id,title,created_at) VALUES(?,?,?,?,?)",id,x.channel,who.id,title,now),stmt(db,"INSERT INTO network_posts(id,thread_id,author_id,body,created_at) VALUES(?,?,?,?,?)",crypto.randomUUID(),id,who.id,body,now)]);return response(201,{id});
 }
 if(p==="/api/network/posts"&&(get||post)){
  const x=post?await json(request):{thread:url.searchParams.get("thread")};if(!idRE.test(x.thread||""))throw Error("Invalid thread");
  const thread=await first(db,"SELECT t.id FROM network_threads t JOIN network_channels c ON c.id=t.channel_id JOIN network_members m ON m.id=t.author_id WHERE t.id=? AND t.hidden=0 AND c.enabled=1 AND m.status='ACTIVE'"+visibility,x.thread,who.id,who.id);if(!thread)return response(404,{error:"Thread unavailable"});
  if(get)return response(200,{posts:await all(db,"SELECT p.id,p.author_id,m.display_name,p.body,p.created_at FROM network_posts p JOIN network_members m ON m.id=p.author_id WHERE p.thread_id=? AND p.hidden=0 AND m.status='ACTIVE'"+visibility+" ORDER BY p.created_at LIMIT 100",x.thread,who.id,who.id)});
  const body=bounded(x.body,4000,true),id=crypto.randomUUID();
  const result=await stmt(db,"INSERT INTO network_posts(id,thread_id,author_id,body,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM network_posts WHERE author_id=? AND created_at>?)<10",id,x.thread,who.id,body,now,who.id,now-60).run();if(result.meta?.changes!==1)return response(429,{error:"Posting temporarily limited"});return response(201,{id});
 }
 if(p==="/api/network/block"&&post){
  const x=await json(request);if(!idRE.test(x.memberId||"")||x.memberId===who.id)throw Error("Invalid member");
  await stmt(db,"INSERT OR IGNORE INTO network_blocks VALUES(?,?)",who.id,x.memberId).run();return response(200,{blocked:true});
 }
 if(p==="/api/network/report"&&post){
  const x=await json(request),reason=bounded(x.reason,1000,true);
  if(!["profile","thread","post","chat"].includes(x.kind)||!idRE.test(x.id||""))throw Error("Invalid report");
  const id=crypto.randomUUID(),result=await stmt(db,"INSERT INTO network_reports(id,reporter_id,target_kind,target_id,reason,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM network_reports WHERE reporter_id=? AND created_at>?)<5",id,who.id,x.kind,x.id,reason,now,who.id,now-3600).run();if(result.meta?.changes!==1)return response(429,{error:"Report limit reached"});return response(201,{reported:true});
 }
 return response(404,{error:"Not found"});
 }catch{return response(400,{error:"Request invalid or unavailable"});}
}
export default {fetch:networkRoute};
