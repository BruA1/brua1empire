"use strict";
const profiles=[["Sample guitarist","Musician","Guitar · Rock, blues"],["Sample vocalist","Vocalist","R&B · Soul"],["Sample producer","Producer","FL Studio · Hip-hop"],["Sample writer","Songwriter","Pop · Lyrics"],["Sample ghostwriter","Ghostwriter","Rap · Hooks"],["Sample engineer","Audio engineer","Mixing · Mastering"],["Sample DJ","DJ","Live sets · Dance"],["Sample studio","Recording studio","Recording · Session work"],["Sample videographer","Video creator","Music videos · Editing"],["Sample recording artist","Artist","Hip-hop · Rap"],["Sample carpenter","Carpenter","Trim · Framing · Remodeling"],["Sample builder","Contractor / builder","Residential renovation"],["Sample electrician","Electrician","Residential electrical service"],["Sample plumber","Plumber","Plumbing service"],["Sample painter","Painter","Interior · Exterior"],["Sample repair professional","Handyman / repair","Home maintenance"],["Sample designer","Graphic designer","Logos · Brand design"],["Sample photographer","Photographer","Portraits · Events"],["Sample web developer","Web developer","Business websites"],["Sample service professional","Other service professional","Independent local services"]];
const channels={"General":[["Sample member A","What are you creating this week?"],["Sample member B","Working on a new song and looking for feedback."]],"Producers":[["Sample producer","Which production workflow helps you finish more tracks?"]],"Musicians":[["Sample guitarist","Looking to connect with keyboard players and drummers."]],"Vocalists":[["Sample vocalist","I'd love to collaborate on an R&B project."]],"Songwriters":[["Sample writer","Anyone interested in a songwriting session?"]],"Collaborations":[["Sample artist","Seeking a producer for a new single."]],"Music Feedback":[["Sample member A","Share your work and ask for constructive feedback."]],"Opportunities":[["Sample engineer","Post music collaborations or professional service opportunities here."]]};
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
 const roleLabels={"musician":"Musician","vocalist":"Vocalist","producer":"Producer","songwriter":"Songwriter","ghostwriter":"Ghostwriter","audio_engineer":"Audio engineer","dj":"DJ","recording_studio":"Recording studio","video_creator":"Video creator","artist":"Artist","carpenter":"Carpenter","contractor":"Contractor / builder","electrician":"Electrician","plumber":"Plumber","painter":"Painter","handyman":"Handyman / repair","graphic_designer":"Graphic designer","photographer":"Photographer","web_developer":"Web developer","other_service":"Other service professional"};
 let token=sessionStorage.getItem("brua1_network_session")||"",config=null,health=null,selectedChannel=null,selectedThread=null,chatTimer=null,chatGeneration=0,chatBusy=false,lastChatSignature="";
 const roleInputs=new Map();
 for(const [key,label] of Object.entries(roleLabels)){const option=node("option",label);option.value=key;by("live-role-filter").append(option);const wrap=node("label",label),cb=node("input");cb.type="checkbox";cb.value=key;wrap.prepend(cb);by("profile-roles").append(wrap);roleInputs.set(key,cb);}
 function stopChat(){if(chatTimer!==null)clearInterval(chatTimer);chatTimer=null;chatGeneration++;chatBusy=false;lastChatSignature="";}
 function lockWorkspace(){stopChat();workspace.hidden=true;by("live-messages").replaceChildren();by("live-compose").replaceChildren();by("live-directory").replaceChildren();}
 async function loadProfile(){const r=await api("profile"),p=r.profile;for(const [id,key] of [["profile-name","display_name"],["profile-location","location"],["profile-genres","genres"],["profile-skills","instruments"],["profile-url","portfolio_url"],["profile-bio","bio"]])by(id).value=p[key]||"";for(const [key,cb] of roleInputs)cb.checked=r.roles.includes(key);by("profile-visible").checked=!!p.directory_visible;by("profile-available").checked=!!p.available;}
 by("profile-save").addEventListener("click",async()=>{const b=by("profile-save"),status=by("profile-status");b.disabled=true;try{const roles=[...roleInputs].filter(([,cb])=>cb.checked).map(([k])=>k);if(roles.length>10)throw Error("Choose up to 10 professions.");await api("profile",{displayName:by("profile-name").value,bio:by("profile-bio").value,location:by("profile-location").value,genres:by("profile-genres").value,instruments:by("profile-skills").value,portfolioUrl:by("profile-url").value,roles,available:by("profile-available").checked,directoryVisible:by("profile-visible").checked});status.textContent="Profile saved.";await loadDirectory();}catch(e){status.textContent=e.message;}finally{b.disabled=false;}});
 const setStatus=s=>status.textContent=s;
 async function api(path,body,auth=true){
  const response=await fetch(API+"/api/network/"+path,{method:body===undefined?"GET":"POST",headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(auth&&token?{Authorization:"Bearer "+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){const e=Error("Request unavailable ("+response.status+").");e.status=response.status;throw e;}return response.json();
 }
 function action(label,fn){const b=node("button",label);b.type="button";b.addEventListener("click",async()=>{b.disabled=true;try{await fn()}catch(e){setStatus(e.message)}finally{b.disabled=false}});return b;}
 function textInput(label,secret=false){const wrap=node("label",label),input=node("input");input.type=secret?"password":"text";input.autocomplete=secret?"off":"off";wrap.append(input);return [wrap,input]}
 function setToken(t){token=t;sessionStorage.setItem("brua1_network_session",t);}
 async function checkAccess(){
  try{await api("me");workspace.hidden=false;setStatus("Membership verified. Community access unlocked.");await loadProfile();await loadDirectory();await loadChannels();}
  catch(e){lockWorkspace();if(e.status===401)setStatus("Sign in and complete payment to unlock the community.");else setStatus("Member access could not be verified.");}
 }
 async function refresh(){
  const r=await api("billing/refresh",{});
  setStatus(r.accessUntil>Date.now()/1000?"Paid access verified.":"Payment is not yet verified. Try refreshing after PayPal completes it.");
  await checkAccess();
 }
 async function afterLogin(){
  by("refresh-subscription").hidden=!config;by("cancel-subscription").hidden=!config;by("logout-member").hidden=false;by("billing-consent").hidden=!config;
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
  by("cancel-subscription").addEventListener("click",async()=>{
   if(!window.confirm("Cancel future recurring payments? Your verified paid access can continue through the paid period."))return;
   const b=by("cancel-subscription");b.disabled=true;
   try{const r=await api("billing/cancel",{confirm:true});await checkAccess();setStatus(r.cancellationConfirmed?"PayPal confirms cancellation. No future renewal is scheduled.":"Cancellation has not yet been confirmed. Check PayPal automatic payments.");}
   catch{setStatus("Cancellation could not be confirmed here. Use PayPal automatic payments to stop future charges or contact support.");}
   finally{b.disabled=false;}
  });
  by("logout-member").addEventListener("click",async()=>{try{await api("auth/logout",{});}finally{lockWorkspace();token="";sessionStorage.removeItem("brua1_network_session");location.replace(location.pathname+"#membership");}});
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
  const r=await api("directory?q="+encodeURIComponent(by("live-directory-search").value)+"&role="+encodeURIComponent(by("live-role-filter").value));const target=by("live-directory");target.replaceChildren();
  for(const p of r.profiles){const card=node("article","","profile");card.append(node("h3",p.display_name),node("p",(p.roles||"").split(",").filter(Boolean).map(r=>roleLabels[r]||r).join(" · ")||"Member","role"),node("p",p.location),node("p",p.instruments),node("p",p.genres),node("p",p.bio));if(p.available)card.append(node("p","Available for work or collaboration","role"));if(p.portfolio_url){try{const u=new URL(p.portfolio_url);if(u.protocol==="https:"&&!u.username&&!u.password){const a=node("a","Portfolio / website");a.href=u.href;a.target="_blank";a.rel="noopener noreferrer";card.append(a);}}catch{}}target.append(card);}
  if(!target.children.length)target.append(node("p","No matching member profiles."));
 }
 by("live-directory-button").addEventListener("click",()=>loadDirectory().catch(e=>setStatus(e.message)));
 async function loadChannels(){
  const r=await api("channels"),target=by("live-channels");target.replaceChildren();
  for(const c of r.channels)target.append(action("# "+c.title,async()=>{selectedChannel=c;selectedThread=null;await renderChannel();}));
  if(r.channels.length){selectedChannel=r.channels.find(c=>c.id==="general")||r.channels[0];selectedThread=null;await renderChannel();}
 }
 async function renderChannel(){
  stopChat();const generation=chatGeneration,c=selectedChannel,area=by("live-messages"),compose=by("live-compose");area.replaceChildren();compose.replaceChildren();by("live-channel-title").textContent=c.title;by("live-chat-status").textContent="";
  const postInput=node("textarea");postInput.maxLength=2000;postInput.setAttribute("aria-label","Message");
  function renderMessages(rows){for(const m of rows){const row=node("article","","message");row.append(node("strong",m.display_name),node("p",m.body));area.append(row);}}
  if(c.kind==="chat"){
   const indicator=by("live-chat-status");
   async function refreshChat(){if(document.hidden||workspace.hidden||generation!==chatGeneration||chatBusy)return;chatBusy=true;try{const r=await api("chat?channel="+encodeURIComponent(c.id));if(generation!==chatGeneration)return;const signature=JSON.stringify(r.messages);if(signature!==lastChatSignature){const nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<80;area.replaceChildren();renderMessages(r.messages);lastChatSignature=signature;if(nearBottom)area.scrollTop=area.scrollHeight;}indicator.textContent="Live chat · refreshes every 5 seconds";}catch(e){if(generation!==chatGeneration)return;if(e.status===401){lockWorkspace();setStatus("Membership access ended. Sign in or verify your subscription.");}else indicator.textContent="Chat temporarily unavailable; retrying.";}finally{if(generation===chatGeneration)chatBusy=false;}}
   compose.append(postInput,action("Send",async()=>{const body=postInput.value;if(!body.trim())return;await api("chat",{channel:c.id,body});postInput.value="";await refreshChat();}),action("Refresh",refreshChat));await refreshChat();if(generation===chatGeneration)chatTimer=setInterval(refreshChat,5000);
  }
  else if(selectedThread){const r=await api("posts?thread="+encodeURIComponent(selectedThread));renderMessages(r.posts);compose.append(postInput,action("Reply",async()=>{await api("posts",{thread:selectedThread,body:postInput.value});await renderChannel();}),action("Back to threads",async()=>{selectedThread=null;await renderChannel();}));}
  else{const r=await api("threads?channel="+encodeURIComponent(c.id));for(const t of r.threads)area.append(action(t.title+" — "+t.display_name,async()=>{selectedThread=t.id;await renderChannel();}));const [wrap,input]=textInput("Thread title");compose.append(wrap,postInput,action("Create thread",async()=>{const t=await api("threads",{channel:c.id,title:input.value,body:postInput.value});selectedThread=t.id;await renderChannel();}));}
 }
})();
