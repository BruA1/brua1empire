"use strict";
const professionGroups={"Music":{"musician":"Musician","vocalist":"Vocalist / singer","producer":"Music producer","songwriter":"Songwriter","ghostwriter":"Music ghostwriter","audio_engineer":"Audio engineer","dj":"DJ","recording_studio":"Recording studio","video_creator":"Music video creator","artist":"Recording artist"},"Inspiration":{"motivational_speaker":"Motivational speaker","inspirational_creator":"Inspirational content creator","personal_growth_mentor":"Personal growth mentor"},"Carpentry":{"carpenter":"Carpenter","contractor":"Carpentry contractor / builder","finish_carpenter":"Finish carpenter","framing_carpenter":"Framing carpenter","cabinetmaker":"Cabinetmaker","painter":"Painter"}};
const professionLabels={"musician":"Musician","vocalist":"Vocalist / singer","producer":"Music producer","songwriter":"Songwriter","ghostwriter":"Music ghostwriter","audio_engineer":"Audio engineer","dj":"DJ","recording_studio":"Recording studio","video_creator":"Music video creator","artist":"Recording artist","motivational_speaker":"Motivational speaker","inspirational_creator":"Inspirational content creator","personal_growth_mentor":"Personal growth mentor","carpenter":"Carpenter","contractor":"Carpentry contractor / builder","finish_carpenter":"Finish carpenter","framing_carpenter":"Framing carpenter","cabinetmaker":"Cabinetmaker","painter":"Painter"};
const profiles=[["Sample guitarist","musician","Guitar · Rock, blues"],["Sample singer","vocalist","R&B · Soul"],["Sample producer","producer","FL Studio · Hip-hop"],["Sample songwriter","songwriter","Pop · Lyrics"],["Sample ghostwriter","ghostwriter","Rap · Hooks"],["Sample engineer","audio_engineer","Mixing · Mastering"],["Sample DJ","dj","Live sets · Dance"],["Sample recording studio","recording_studio","Recording · Session work"],["Sample music video creator","video_creator","Music videos · Editing"],["Sample recording artist","artist","Hip-hop · Rap"],["Sample speaker","motivational_speaker","Encouragement · Personal growth"],["Sample inspiration creator","inspirational_creator","Affirmations · Positive messages"],["Sample mentor","personal_growth_mentor","Goal setting · Self-discipline"],["Sample carpenter","carpenter","Trim · Framing · Remodeling"],["Sample builder","contractor","Carpentry · Residential construction"],["Sample finish carpenter","finish_carpenter","Trim · Doors · Moulding"],["Sample framing carpenter","framing_carpenter","Wood framing · Decks"],["Sample cabinetmaker","cabinetmaker","Cabinetry · Custom woodwork"],["Sample painter","painter","Interior · Exterior · Finish painting"]];
const channels={"General":[["Sample member A","What are you creating this week?"],["Sample member B","Working on a new song and looking for feedback."]],"Producers":[["Sample producer","Which production workflow helps you finish more tracks?"]],"Musicians":[["Sample guitarist","Looking to connect with keyboard players and drummers."]],"Vocalists":[["Sample vocalist","I'd love to collaborate on an R&B project."]],"Songwriters":[["Sample writer","Anyone interested in a songwriting session?"]],"Collaborations":[["Sample artist","Seeking a producer for a new single."]],"Music Feedback":[["Sample member A","Share your work and ask for constructive feedback."]],"Opportunities":[["Sample engineer","Post music collaborations, inspirational projects or carpentry opportunities here."]]};
function node(tag,text,cls){const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e}
const search=document.getElementById("directory-search"),role=document.getElementById("role-filter"),grid=document.getElementById("profile-grid");
function renderDirectory(){const q=search.value.trim().toLowerCase(),r=role.value;grid.replaceChildren();for(const [name,key,skills] of profiles){const profession=professionLabels[key];if(r&&key!==r||q&&!(name+" "+profession+" "+skills).toLowerCase().includes(q))continue;const card=node("article","","profile");card.append(node("h3",name),node("p",profession,"role"),node("p",skills),node("p","Illustrative profile"));grid.append(card)}if(!grid.children.length)grid.append(node("p","No sample profiles match your search."))}
search.addEventListener("input",renderDirectory);role.addEventListener("change",renderDirectory);renderDirectory();
const buttons=document.getElementById("channel-list"),title=document.getElementById("channel-title"),messages=document.getElementById("message-list");
function selectChannel(name){title.textContent="# "+name;messages.replaceChildren();for(const [author,body] of channels[name]){const row=node("article","","message");row.append(node("strong",author),node("p",body));messages.append(row)}for(const b of buttons.children)b.setAttribute("aria-pressed",String(b.dataset.channel===name))}
for(const name of Object.keys(channels)){const b=node("button","# "+name);b.type="button";b.dataset.channel=name;b.addEventListener("click",()=>selectChannel(name));buttons.append(b)}selectChannel("General");
/* Actual membership flow; only enabled after server reports the relevant release flags. */
(async function(){
 const API="https://brua1-music-network.a1productions0527.workers.dev";
 const by=id=>document.getElementById(id),account=by("member-account"),status=by("account-status"),billing=by("billing-status"),workspace=by("member-workspace");
 const roleLabels=professionLabels;
 const requestedChannel=new URLSearchParams(location.search).get("channel")||"";
 let initialChannelJump=Boolean(requestedChannel);
 let token="";try{token=sessionStorage.getItem("brua1_network_session")||"";}catch{}let config=null,health=null,selectedChannel=null,selectedThread=null,chatTimer=null,chatGeneration=0,chatBusy=false,lastChatSignature="";
 const roleInputs=new Map();
 for(const [group,roles] of Object.entries(professionGroups)){const optgroup=node("optgroup");optgroup.label=group;by("live-role-filter").append(optgroup);const field=node("fieldset"),legend=node("legend",group);field.append(legend);by("profile-roles").append(field);for(const [key,label] of Object.entries(roles)){const option=node("option",label);option.value=key;optgroup.append(option);const wrap=node("label",label),cb=node("input");cb.type="checkbox";cb.value=key;wrap.prepend(cb);field.append(wrap);roleInputs.set(key,cb);}}
 function stopChat(){if(chatTimer!==null)clearInterval(chatTimer);chatTimer=null;chatGeneration++;chatBusy=false;lastChatSignature="";}
 function lockWorkspace(){stopChat();by("paypal-payment-management").hidden=true;workspace.hidden=true;by("live-messages").replaceChildren();by("live-compose").replaceChildren();by("live-directory").replaceChildren();}
 async function loadProfile(){const r=await api("profile"),p=r.profile;for(const [id,key] of [["profile-name","display_name"],["profile-location","location"],["profile-genres","genres"],["profile-skills","instruments"],["profile-url","portfolio_url"],["profile-bio","bio"]])by(id).value=p[key]||"";for(const [key,cb] of roleInputs)cb.checked=r.roles.includes(key);by("profile-visible").checked=!!p.directory_visible;by("profile-available").checked=!!p.available;}
 by("profile-save").addEventListener("click",async()=>{const b=by("profile-save"),status=by("profile-status");b.disabled=true;try{const roles=[...roleInputs].filter(([,cb])=>cb.checked).map(([k])=>k);if(roles.length>10)throw Error("Choose up to 10 professions.");await api("profile",{displayName:by("profile-name").value,bio:by("profile-bio").value,location:by("profile-location").value,genres:by("profile-genres").value,instruments:by("profile-skills").value,portfolioUrl:by("profile-url").value,roles,available:by("profile-available").checked,directoryVisible:by("profile-visible").checked});status.textContent="Profile saved.";await loadDirectory();}catch(e){status.textContent=e.message;}finally{b.disabled=false;}});
 const setStatus=s=>status.textContent=s;
 function forgetSession(){token="";try{sessionStorage.removeItem("brua1_network_session");}catch{}}
 function signInStatus(s){by("signin-status").textContent=s;}
 async function api(path,body,auth=true){
  const response=await fetch(API+"/api/network/"+path,{method:body===undefined?"GET":"POST",headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(auth&&token?{Authorization:"Bearer "+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){const e=Error("Request unavailable ("+response.status+").");e.status=response.status;throw e;}return response.json();
 }
 function action(label,fn){const b=node("button",label);b.type="button";b.addEventListener("click",async()=>{b.disabled=true;try{await fn()}catch(e){setStatus(e.message)}finally{b.disabled=false}});return b;}
 function textInput(label,secret=false){const wrap=node("label",label),input=node("input");input.type=secret?"password":"text";input.autocomplete=secret?"off":"off";wrap.append(input);return [wrap,input]}
 function setToken(t){if(typeof t!=="string"||!/^[a-f0-9]{64}$/.test(t))throw Error("Server did not return a valid session.");token=t;try{sessionStorage.setItem("brua1_network_session",t);}catch{setStatus("Signed in for this page only; your browser blocks session storage.");}}
 async function checkAccess({focus=false}={}){
  let me;
  try{me=await api("me");}
  catch(e){lockWorkspace();by("member-signin-panel").hidden=false;by("retry-workspace").hidden=e.status===401;if(e.status===401){forgetSession();by("logout-member").hidden=true;signInStatus("Your session is not active. Sign in again with your saved access key.");setStatus("Sign in to unlock the community.");}else{setStatus("Your session could not be checked. Retry loading the community.");}return false;}
  by("paypal-payment-management").hidden=!(health?.billingEnabled===true&&config&&!me.freeBeta);
  by("member-signin-panel").hidden=true;by("beta-registration").hidden=true;workspace.hidden=false;by("logout-member").hidden=false;
  by("member-welcome").textContent="Welcome, "+me.member.display_name+"!";
  setStatus(me.freeBeta?"Signed in successfully — free founding membership active.":"Signed in successfully — membership active.");
  if(focus&&!initialChannelJump){by("member-welcome").focus({preventScroll:true});by("member-welcome").scrollIntoView({block:"start"});}
  const results=await Promise.allSettled([loadProfile(),loadDirectory(),loadChannels()]);
  const names=["profile","directory","community channels"],failed=names.filter((_,i)=>results[i].status==="rejected");
  by("retry-workspace").hidden=failed.length===0;
  if(failed.length)setStatus("Signed in successfully, but "+failed.join(", ")+" could not load. Use Retry loading community.");
  if(initialChannelJump&&results[2].status==="fulfilled"&&by("beta-key-panel").hidden){initialChannelJump=false;by("live-community").focus({preventScroll:true});by("live-community").scrollIntoView({block:"start"});}
  return true;
 }
 async function refresh(){
  const r=await api("billing/refresh",{});
  setStatus(r.accessUntil>Date.now()/1000?"Paid access verified.":"Payment is not yet verified. Try refreshing after PayPal completes it.");
  await checkAccess();
 }
 async function afterLogin(options={}){
  by("refresh-subscription").hidden=!config;by("cancel-subscription").hidden=!config;by("logout-member").hidden=false;by("billing-consent").hidden=!config;
  for(const c of ["monthly","annual"])by("subscribe-"+c).disabled=!config?.plans.some(p=>p.cycle===c);
  return await checkAccess(options);
 }
 by("retry-workspace").addEventListener("click",()=>checkAccess({focus:true}));
 try{
  const r=await fetch(API+"/health",{cache:"no-store"});if(!r.ok)return;health=await r.json();
  if(!health.memberApiEnabled)return;
  account.hidden=false;by("member-signin-link").hidden=false;
  if(health.billingEnabled){config=await api("billing/config",undefined,false);by("membership-terms-link").href=config.termsUrl;billing.textContent="Sign in to subscribe. Recurring payment approval takes place on PayPal.";}
  const [a,access]=textInput("Private access key",true);access.autocomplete="current-password";
  access.placeholder="Paste your saved private access key";access.maxLength=128;access.spellcheck=false;access.autocapitalize="none";
  const signIn=action("Sign in",async()=>{const key=access.value.trim().toLowerCase();if(!/^[a-f0-9]{64}$/.test(key)){signInStatus("Enter the full 64-character private access key from your account registration.");return;}
   signInStatus("Checking your access key…");
   try{const r=await api("auth/login",{accessKey:key},false);setToken(r.sessionToken);access.value="";signInStatus("Access key accepted.");await afterLogin({focus:true});}
   catch(e){signInStatus(e.status===401?"Sign-in was not accepted. Check your saved access key; too many active sessions can also prevent login.":e.status===503?"Sign-in service is temporarily unavailable.":"Sign-in could not reach the server. Check your connection and try again.");}
  });
  access.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();if(!signIn.disabled)signIn.click();}});
  by("account-controls").append(a,signIn);
  function showKey(key){by("beta-access-key").value=key;by("beta-key-panel").hidden=false;by("beta-key-panel").scrollIntoView();}
  by("beta-copy-key").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(by("beta-access-key").value);setStatus("Access key copied. Save it privately.");}catch{by("beta-access-key").select();setStatus("Copy the selected access key manually.");}});
  by("beta-hide-key").addEventListener("click",()=>{by("beta-access-key").value="";by("beta-key-panel").hidden=true;if(initialChannelJump&&!workspace.hidden&&selectedChannel){initialChannelJump=false;by("live-community").focus({preventScroll:true});by("live-community").scrollIntoView({block:"start"});}});
  if(health.inviteAuthEnabled){
   const [b,invite]=textInput("Invitation code",true);
   by("account-controls").append(b,action("Redeem invitation",async()=>{const r=await api("auth/redeem",{invite:invite.value},false);invite.value="";setToken(r.sessionToken);showKey(r.accessKey);await afterLogin();}));
  }
  if(health.publicBetaEnabled){
   const beta=await api("beta/config",undefined,false);
   by("network-phase").textContent="BRUA1 MUSIC NETWORK / FOUNDING BETA";
   by("network-launch-notice").textContent="Free founding beta. Sample previews are illustrative; sign in to access real member profiles and discussions.";
   by("beta-count").textContent=beta.registered+" founding accounts registered · "+beta.listed+" opted-in professional listings · "+beta.spotsRemaining+" spots remaining.";
   by("beta-join-link").hidden=false;by("beta-membership-link").hidden=false;by("new-member-link").hidden=beta.spotsRemaining===0;
   if(!token&&beta.spotsRemaining>0){
    by("beta-registration").hidden=false;
    let challengeToken="",widget=null,busy=false,created=false;
    const register=by("beta-register"),rs=by("beta-register-status");
    const ready=()=>{register.disabled=busy||created||!challengeToken;};
    const resetChallenge=()=>{challengeToken="";ready();if(widget!==null)try{window.turnstile.reset(widget);}catch{rs.textContent="Refresh this page to restart security verification.";}};
    const challengeScript=node("script");challengeScript.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";challengeScript.async=true;
    challengeScript.addEventListener("load",()=>{widget=window.turnstile.render("#beta-challenge",{sitekey:beta.siteKey,action:"founding_signup",callback:t=>{challengeToken=t;ready();},"expired-callback":()=>{challengeToken="";ready();if(!busy&&!created)rs.textContent="Security verification expired. Complete the refreshed check and try again.";}, "error-callback":()=>{challengeToken="";ready();if(!created)rs.textContent="Security verification unavailable. Open brua1.com in Chrome or Safari and refresh.";}});});
    challengeScript.addEventListener("error",()=>{rs.textContent="Security verification could not load. Open brua1.com in Chrome or Safari and refresh.";});document.head.append(challengeScript);
    register.addEventListener("click",async()=>{if(busy||created)return;
     if(!by("beta-adult").checked||!by("beta-consent").checked||!by("beta-name").value.trim()){rs.textContent="Enter a name and accept both confirmations.";return;}
     if(!challengeToken){rs.textContent="Complete security verification first.";ready();return;}
     busy=true;ready();rs.textContent="Creating your free account…";
     try{
      const r=await api("auth/register",{displayName:by("beta-name").value,adultConfirmed:true,acceptedTerms:true,termsVersion:beta.termsVersion,challengeToken},false);
      created=true;challengeToken="";showKey(r.accessKey);setToken(r.sessionToken);by("beta-registration").hidden=true;await afterLogin();by("beta-key-panel").scrollIntoView({block:"start"});
     }catch(e){if(created){setStatus("Account created. Save your private access key before leaving this page. If the community does not load, sign in with that key.");return;}
      rs.textContent=e.status===403?"Security verification was not accepted by the server. Open this page directly in Chrome or Safari (not Messenger or Facebook), complete the new check, and try again.":e.status===409?"All founding spots are currently filled. Existing members can still sign in.":e.status===503?"Registration is temporarily unavailable. Please try again later.":e.status===400?"Registration details were not accepted. Check your name and confirmations.":"Could not confirm registration. If an access key appeared, save it and sign in instead of creating another account. Otherwise contact brua1@brua1.com if this continues.";
      resetChallenge();
     }finally{busy=false;ready();}
    });
   }
  }
  by("refresh-subscription").addEventListener("click",()=>refresh().catch(e=>setStatus(e.message)));
  by("cancel-subscription").addEventListener("click",async()=>{
   if(!window.confirm("Cancel future recurring payments? Your verified paid access can continue through the paid period."))return;
   const b=by("cancel-subscription");b.disabled=true;
   try{const r=await api("billing/cancel",{confirm:true});await checkAccess();setStatus(r.cancellationConfirmed?"PayPal confirms cancellation. No future renewal is scheduled.":"Cancellation has not yet been confirmed. Check PayPal automatic payments.");}
   catch{setStatus("Cancellation could not be confirmed here. Use PayPal automatic payments to stop future charges or contact support.");}
   finally{b.disabled=false;}
  });
  by("logout-member").addEventListener("click",async()=>{try{await api("auth/logout",{});}finally{lockWorkspace();forgetSession();location.replace(location.pathname+"#membership");}});
  for(const cycle of ["monthly","annual"])by("subscribe-"+cycle).addEventListener("click",async()=>{
   const b=by("subscribe-"+cycle);b.disabled=true;
   try{if(!token||!config||!by("accept-membership-terms").checked)throw Error("Sign in and accept the membership terms first.");
    const r=await api("billing/begin",{cycle,acceptedTerms:true,termsVersion:config.termsVersion});
    const u=new URL(r.approvalUrl);if(u.protocol!=="https:"||u.hostname!=="www.paypal.com"||u.username||u.password||u.pathname!=="/webapps/billing/subscriptions")throw Error("Invalid approval URL");
    location.assign(u.href);
   }catch(e){setStatus(e.message);account.scrollIntoView();b.disabled=false;}
  });
  if(token){await afterLogin();const returned=new URLSearchParams(location.search).get("subscription");if(returned==="return"&&config)await refresh();if(returned==="cancel")setStatus("PayPal approval canceled. No membership access has been granted.");if(returned)history.replaceState(null,"",location.pathname+"#member-account");}
 }catch{billing.textContent="Membership service is unavailable. No new payments can be initiated.";by("beta-count").textContent="Could not connect to registration. Reload the page and try again.";setStatus("Membership service could not load. Please retry.");}
 async function loadDirectory(){
  const r=await api("directory?q="+encodeURIComponent(by("live-directory-search").value)+"&role="+encodeURIComponent(by("live-role-filter").value));const target=by("live-directory");target.replaceChildren();
  for(const p of r.profiles){const card=node("article","","profile");card.append(node("h3",p.display_name),node("p",(p.roles||"").split(",").filter(Boolean).map(r=>roleLabels[r]||r).join(" · ")||"Member","role"),node("p",p.location),node("p",p.instruments),node("p",p.genres),node("p",p.bio));if(p.available)card.append(node("p","Available for work or collaboration","role"));if(p.portfolio_url){try{const u=new URL(p.portfolio_url);if(u.protocol==="https:"&&!u.username&&!u.password){const a=node("a","Portfolio / website");a.href=u.href;a.target="_blank";a.rel="noopener noreferrer";card.append(a);}}catch{}}target.append(card);}
  if(!target.children.length)target.append(node("p","No matching member profiles."));
 }
 by("live-directory-button").addEventListener("click",()=>loadDirectory().catch(e=>setStatus(e.message)));
 async function loadChannels(){
  const r=await api("channels"),target=by("live-channels");target.replaceChildren();
  for(const c of r.channels)target.append(action("# "+c.title,async()=>{selectedChannel=c;selectedThread=null;await renderChannel();}));
  if(r.channels.length){selectedChannel=r.channels.find(c=>c.id===requestedChannel)||r.channels.find(c=>c.id==="general")||r.channels[0];selectedThread=null;await renderChannel();}
 }
 async function renderChannel(){
  stopChat();const generation=chatGeneration,c=selectedChannel,area=by("live-messages"),compose=by("live-compose");area.replaceChildren();compose.replaceChildren();by("live-channel-title").textContent=c.title;by("live-chat-status").textContent="";
  const postInput=node("textarea");postInput.maxLength=2000;postInput.setAttribute("aria-label","Message");
  function renderMessages(rows){for(const m of rows){const row=node("article","","message");row.append(node("strong",m.display_name),node("p",m.body));if(m.id&&m.author_id){const kind=c.kind==="chat"?"chat":"post";row.append(action("Report",async()=>{const reason=window.prompt("Why are you reporting this message?");if(reason?.trim()){await api("report",{kind,id:m.id,reason:reason.trim().slice(0,1000)});setStatus("Report received for moderator review.");}}),action("Block member",async()=>{if(window.confirm("Block this member and hide their content?")){await api("block",{memberId:m.author_id});await renderChannel();}}));}area.append(row);}}
  if(c.kind==="chat"){
   const indicator=by("live-chat-status");
   async function refreshChat(){if(document.hidden||workspace.hidden||generation!==chatGeneration||chatBusy)return;chatBusy=true;try{const r=await api("chat?channel="+encodeURIComponent(c.id));if(generation!==chatGeneration)return;const signature=JSON.stringify(r.messages);if(signature!==lastChatSignature){const nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<80;area.replaceChildren();renderMessages(r.messages);lastChatSignature=signature;if(nearBottom)area.scrollTop=area.scrollHeight;}indicator.textContent="Live chat · refreshes every 5 seconds";}catch(e){if(generation!==chatGeneration)return;if(e.status===401){lockWorkspace();setStatus("Membership access ended. Sign in or verify your subscription.");}else indicator.textContent="Chat temporarily unavailable; retrying.";}finally{if(generation===chatGeneration)chatBusy=false;}}
   compose.append(postInput,action("Send",async()=>{const body=postInput.value;if(!body.trim())return;await api("chat",{channel:c.id,body});postInput.value="";await refreshChat();}),action("Refresh",refreshChat));await refreshChat();if(generation===chatGeneration)chatTimer=setInterval(refreshChat,5000);
  }
  else if(selectedThread){const r=await api("posts?thread="+encodeURIComponent(selectedThread));renderMessages(r.posts);compose.append(postInput,action("Reply",async()=>{await api("posts",{thread:selectedThread,body:postInput.value});await renderChannel();}),action("Back to threads",async()=>{selectedThread=null;await renderChannel();}));}
  else{const r=await api("threads?channel="+encodeURIComponent(c.id));for(const t of r.threads)area.append(action(t.title+" — "+t.display_name,async()=>{selectedThread=t.id;await renderChannel();}));const [wrap,input]=textInput("Thread title");compose.append(wrap,postInput,action("Create thread",async()=>{const t=await api("threads",{channel:c.id,title:input.value,body:postInput.value});selectedThread=t.id;await renderChannel();}));}
 }
})();
