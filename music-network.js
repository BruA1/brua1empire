"use strict";
const profiles=[["Sample guitarist","Musician","Guitar · Rock, blues"],["Sample vocalist","Vocalist","R&B · Soul"],["Sample producer","Producer","FL Studio · Hip-hop"],["Sample writer","Songwriter","Pop · Lyrics"],["Sample ghostwriter","Ghostwriter","Rap · Hooks"],["Sample engineer","Audio engineer","Mixing · Mastering"],["Sample DJ","DJ","Live sets · Dance"],["Sample studio","Recording studio","Recording · Session work"],["Sample videographer","Video creator","Music videos · Editing"],["Sample recording artist","Artist","Hip-hop · Rap"]];
const channels={"General":[["Sample member A","What are you creating this week?"],["Sample member B","Working on a new song and looking for feedback."]],"Producers":[["Sample producer","Which production workflow helps you finish more tracks?"]],"Musicians":[["Sample guitarist","Looking to connect with keyboard players and drummers."]],"Vocalists":[["Sample vocalist","I'd love to collaborate on an R&B project."]],"Songwriters":[["Sample writer","Anyone interested in a songwriting session?"]],"Collaborations":[["Sample artist","Seeking a producer for a new single."]],"Music Feedback":[["Sample member A","Share your work and ask for constructive feedback."]],"Opportunities":[["Sample engineer","Post music-related paid opportunities here."]]};
function node(tag,text,cls){const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e}
const search=document.getElementById("directory-search"),role=document.getElementById("role-filter"),grid=document.getElementById("profile-grid");
function renderDirectory(){const q=search.value.trim().toLowerCase(),r=role.value;grid.replaceChildren();for(const [name,profession,skills] of profiles){if(r&&profession!==r||q&&!(name+" "+profession+" "+skills).toLowerCase().includes(q))continue;const card=node("article","","profile");card.append(node("h3",name),node("p",profession,"role"),node("p",skills),node("p","Illustrative profile"));grid.append(card)}if(!grid.children.length)grid.append(node("p","No sample profiles match your search."))}
search.addEventListener("input",renderDirectory);role.addEventListener("change",renderDirectory);renderDirectory();
const buttons=document.getElementById("channel-list"),title=document.getElementById("channel-title"),messages=document.getElementById("message-list");
function selectChannel(name){title.textContent="# "+name;messages.replaceChildren();for(const [author,body] of channels[name]){const row=node("article","","message");row.append(node("strong",author),node("p",body));messages.append(row)}for(const b of buttons.children)b.setAttribute("aria-pressed",String(b.dataset.channel===name))}
for(const name of Object.keys(channels)){const b=node("button","# "+name);b.type="button";b.dataset.channel=name;b.addEventListener("click",()=>selectChannel(name));buttons.append(b)}selectChannel("General");
/* Actual membership flow; only enabled after server reports the relevant release flags. */
(async function(){
 const API="https://brua1-music-network.a1productions0527.workers.dev";
 const by=id=>document.getElementById(id),account=by("member-account"),status=by("account-status"),billing=by("billing-status"),workspace=by("member-workspace");
 let token=sessionStorage.getItem("brua1_network_session")||"",config=null,health=null,selectedChannel=null,selectedThread=null;
 const setStatus=s=>status.textContent=s;
 async function api(path,body,auth=true){
  const response=await fetch(API+"/api/network/"+path,{method:body===undefined?"GET":"POST",headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(auth&&token?{Authorization:"Bearer "+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){const e=Error("Request unavailable ("+response.status+").");e.status=response.status;throw e;}return response.json();
 }
 function action(label,fn){const b=node("button",label);b.type="button";b.addEventListener("click",async()=>{b.disabled=true;try{await fn()}catch(e){setStatus(e.message)}finally{b.disabled=false}});return b;}
 function textInput(label,secret=false){const wrap=node("label",label),input=node("input");input.type=secret?"password":"text";input.autocomplete=secret?"off":"off";wrap.append(input);return [wrap,input]}
 function setToken(t){token=t;sessionStorage.setItem("brua1_network_session",t);}
 async function checkAccess(){
  try{await api("me");workspace.hidden=false;setStatus("Membership verified. Community access unlocked.");await loadDirectory();await loadChannels();}
  catch(e){workspace.hidden=true;if(e.status===401)setStatus("Sign in and complete payment to unlock the community.");else setStatus("Member access could not be verified.");}
 }
 async function refresh(){
  const r=await api("billing/refresh",{});
  setStatus(r.accessUntil>Date.now()/1000?"Paid access verified.":"Payment is not yet verified. Try refreshing after PayPal completes it.");
  await checkAccess();
 }
 async function afterLogin(){
  by("refresh-subscription").hidden=!config;by("logout-member").hidden=false;by("billing-consent").hidden=!config;
  for(const c of ["monthly","annual"])by("subscribe-"+c).disabled=!config?.plans.some(p=>p.cycle===c);
  await checkAccess();
 }
 try{
  const r=await fetch(API+"/health",{cache:"no-store"});if(!r.ok)return;health=await r.json();
  if(!health.memberApiEnabled)return;
  account.hidden=false;
  if(health.billingEnabled){config=await api("billing/config",undefined,false);by("membership-terms-link").href=config.termsUrl;billing.textContent="Sign in to subscribe. Recurring payment approval takes place on PayPal.";}
  if(health.inviteAuthEnabled){
   const [a,access]=textInput("Access key",true),[b,invite]=textInput("Invitation code",true);
   by("account-controls").append(a,action("Sign in",async()=>{const r=await api("auth/login",{accessKey:access.value},false);access.value="";setToken(r.sessionToken);await afterLogin()}),b,action("Redeem invitation",async()=>{const r=await api("auth/redeem",{invite:invite.value},false);invite.value="";setToken(r.sessionToken);await afterLogin();const reveal=node("p","Save your access key now: "+r.accessKey);reveal.className="notice";by("account-controls").append(reveal,action("Hide key",async()=>reveal.remove()));}));
  }
  by("refresh-subscription").addEventListener("click",()=>refresh().catch(e=>setStatus(e.message)));
  by("logout-member").addEventListener("click",async()=>{try{await api("auth/logout",{});}finally{token="";sessionStorage.removeItem("brua1_network_session");location.replace(location.pathname+"#membership");}});
  for(const cycle of ["monthly","annual"])by("subscribe-"+cycle).addEventListener("click",async()=>{
   const b=by("subscribe-"+cycle);b.disabled=true;
   try{if(!token||!config||!by("accept-membership-terms").checked)throw Error("Sign in and accept the membership terms first.");
    const r=await api("billing/begin",{cycle,acceptedTerms:true,termsVersion:config.termsVersion});
    const u=new URL(r.approvalUrl);if(u.protocol!=="https:"||u.hostname!=="www.paypal.com"||u.username||u.password||u.pathname!=="/webapps/billing/subscriptions")throw Error("Invalid approval URL");
    location.assign(u.href);
   }catch(e){setStatus(e.message);account.scrollIntoView();b.disabled=false;}
  });
  if(token){await afterLogin();const returned=new URLSearchParams(location.search).get("subscription");if(returned==="return"&&config)await refresh();if(returned==="cancel")setStatus("PayPal approval canceled. No membership access has been granted.");if(returned)history.replaceState(null,"",location.pathname+"#member-account");}
 }catch{billing.textContent="Membership service is unavailable. No new payments can be initiated.";}
 async function loadDirectory(){
  const r=await api("directory?q="+encodeURIComponent(by("live-directory-search").value));const target=by("live-directory");target.replaceChildren();
  for(const p of r.profiles){const card=node("article","","profile");card.append(node("h3",p.display_name),node("p",p.roles||"Music professional","role"),node("p",p.instruments),node("p",p.genres),node("p",p.bio));target.append(card);}
  if(!target.children.length)target.append(node("p","No matching member profiles."));
 }
 by("live-directory-button").addEventListener("click",()=>loadDirectory().catch(e=>setStatus(e.message)));
 async function loadChannels(){
  const r=await api("channels"),target=by("live-channels");target.replaceChildren();
  for(const c of r.channels)target.append(action("# "+c.title,async()=>{selectedChannel=c;selectedThread=null;await renderChannel();}));
  if(r.channels.length){selectedChannel=r.channels[0];selectedThread=null;await renderChannel();}
 }
 async function renderChannel(){
  const c=selectedChannel,area=by("live-messages"),compose=by("live-compose");area.replaceChildren();compose.replaceChildren();by("live-channel-title").textContent=c.title;
  const postInput=node("textarea");postInput.maxLength=2000;postInput.setAttribute("aria-label","Message");
  function renderMessages(rows){for(const m of rows){const row=node("article","","message");row.append(node("strong",m.display_name),node("p",m.body));area.append(row);}}
  if(c.kind==="chat"){const r=await api("chat?channel="+encodeURIComponent(c.id));renderMessages(r.messages);compose.append(postInput,action("Send",async()=>{await api("chat",{channel:c.id,body:postInput.value});await renderChannel();}),action("Refresh",renderChannel));}
  else if(selectedThread){const r=await api("posts?thread="+encodeURIComponent(selectedThread));renderMessages(r.posts);compose.append(postInput,action("Reply",async()=>{await api("posts",{thread:selectedThread,body:postInput.value});await renderChannel();}),action("Back to threads",async()=>{selectedThread=null;await renderChannel();}));}
  else{const r=await api("threads?channel="+encodeURIComponent(c.id));for(const t of r.threads)area.append(action(t.title+" — "+t.display_name,async()=>{selectedThread=t.id;await renderChannel();}));const [wrap,input]=textInput("Thread title");compose.append(wrap,postInput,action("Create thread",async()=>{const t=await api("threads",{channel:c.id,title:input.value,body:postInput.value});selectedThread=t.id;await renderChannel();}));}
 }
})();
