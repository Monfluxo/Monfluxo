import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export const ADMIN_COOKIE='mf_admin_session';
const duration=3600;
function sessionKey(){const value=process.env.MONFLUXO_ADMIN_SESSION_SECRET;if(!value||!/^[0-9a-f]{64}$/.test(value))throw Error('Admin session unavailable');return Buffer.from(value,'hex');}
export function sealAdminSession(key,now=Date.now()){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',sessionKey(),iv);
 const content=Buffer.concat([cipher.update(JSON.stringify({key,expires:now+duration*1000}),'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),content]).toString('base64url');
}
export function readAdminSession(value,now=Date.now()){
 try{if(typeof value!=='string'||value.length>2048||!/^[A-Za-z0-9_-]+$/.test(value))return null;
 const bytes=Buffer.from(value,'base64url');if(bytes.length<29)return null;
 const decipher=createDecipheriv('aes-256-gcm',sessionKey(),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));
 const data=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
 return typeof data.key==='string'&&data.key.length>0&&data.expires>now&&data.expires<=now+duration*1000?data.key:null;
 }catch{return null;}
}
export function adminKeyForRequest(request){const value=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length+1);return readAdminSession(value);}
export function adminCookie(value,maxAge=duration){return `${ADMIN_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`;}
