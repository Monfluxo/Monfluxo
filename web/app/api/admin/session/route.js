import {sameOrigin} from '../../../../lib/creditProxy';
import {sealAdminSession,adminCookie} from '../../../../lib/adminSession';
const base=process.env.MONFLUXO_BACKEND_URL||'http://127.0.0.1:3000';
export async function POST(request){
 if(!sameOrigin(request))return Response.json({error:'invalid_origin'},{status:403});
 try{const body=await request.text();if(body.length>2048)return Response.json({error:'request_too_large'},{status:413});const {key}=JSON.parse(body);
 if(typeof key!=='string'||!key.trim()||key.length>512)return Response.json({error:'Invalid admin key'},{status:401});
 const r=await fetch(`${base}/api/admin/credits`,{cache:'no-store',headers:{'X-Monfluxo-Admin-Key':key.trim()},signal:AbortSignal.timeout(15000)});
 if(!r.ok)return Response.json({error:r.status===401?'Invalid admin key':'Admin service unavailable'},{status:r.status===401?401:503});
 return Response.json({ok:true},{headers:{'Set-Cookie':adminCookie(sealAdminSession(key.trim())),'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Admin service unavailable'},{status:503});}
}
export async function DELETE(request){if(!sameOrigin(request))return Response.json({error:'invalid_origin'},{status:403});return Response.json({ok:true},{headers:{'Set-Cookie':adminCookie('',0),'Cache-Control':'no-store'}});}
