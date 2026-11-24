// Invite-only beta authentication. High-entropy access keys, not passwords.
// Never store raw invites, access keys or session tokens. No public enrollment.
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");
const digest=async raw=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw))));
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const valid=x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const first=(db,sql,...args)=>stmt(db,sql,...args).first();
export async function redeemInvite(db,raw,now){
 if(!valid(raw))return null;
 const hash=await digest(raw),invite=await first(db,"SELECT i.member_id FROM network_invites i JOIN network_members m ON m.id=i.member_id WHERE i.token_hash=? AND i.expires_at>? AND i.used_at IS NULL AND m.status='INVITED'",hash,now);
 if(!invite)return null;
 const id=invite.member_id,accessKey=random(),sessionToken=random(),keyHash=await digest(accessKey),sessionHash=await digest(sessionToken),expiresAt=now+12*3600;
 const results=await db.batch([
  stmt(db,"INSERT INTO network_login_keys(key_hash,member_id,created_at) SELECT ?,member_id,? FROM network_invites WHERE token_hash=? AND member_id=? AND expires_at>? AND used_at IS NULL ON CONFLICT DO NOTHING",keyHash,now,hash,id,now),
  stmt(db,"UPDATE network_invites SET used_at=? WHERE token_hash=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM network_login_keys WHERE key_hash=? AND member_id=?)",now,hash,keyHash,id),
  stmt(db,"UPDATE network_members SET status='ACTIVE' WHERE id=? AND status='INVITED' AND EXISTS(SELECT 1 FROM network_login_keys WHERE key_hash=? AND member_id=?)",id,keyHash,id),
  stmt(db,"INSERT INTO network_sessions(token_hash,member_id,expires_at) SELECT ?,member_id,? FROM network_login_keys WHERE key_hash=? AND revoked_at IS NULL",sessionHash,expiresAt,keyHash)
 ]);
 if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1||results[3]?.meta?.changes!==1)return null;
 return {accessKey,sessionToken,expiresAt};
}
export async function login(db,raw,now){
 if(!valid(raw))return null;
 const hash=await digest(raw),row=await first(db,"SELECT k.member_id FROM network_login_keys k JOIN network_members m ON m.id=k.member_id WHERE k.key_hash=? AND k.revoked_at IS NULL AND m.status='ACTIVE'",hash);
 if(!row)return null;
 const sessionToken=random(),expiresAt=now+12*3600;
 const result=await stmt(db,"INSERT INTO network_sessions(token_hash,member_id,expires_at) SELECT ?,k.member_id,? FROM network_login_keys k JOIN network_members m ON m.id=k.member_id WHERE k.key_hash=? AND k.revoked_at IS NULL AND m.status='ACTIVE' AND (SELECT COUNT(*) FROM network_sessions WHERE member_id=k.member_id AND expires_at>? AND revoked_at IS NULL)<10",await digest(sessionToken),expiresAt,hash,now).run();
 if(result.meta?.changes!==1)return null;
 return {sessionToken,expiresAt};
}
export async function logout(db,raw,now){
 if(valid(raw))await stmt(db,"UPDATE network_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE token_hash=?",now,await digest(raw)).run();
}
