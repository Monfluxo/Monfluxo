import {sameOrigin} from '../../../../lib/creditProxy';
import {adminKeyForRequest} from '../../../../lib/adminSession';
const BACKEND_BASE=process.env.MONFLUXO_BACKEND_URL||"http://127.0.0.1:3000";
export async function GET(request){if(!adminKeyForRequest(request))return Response.json({error:"admin_login_required"},{status:401});try{const r=await fetch(`${BACKEND_BASE}/api/admin/indexer`,{cache:"no-store",headers:{"X-Monfluxo-Admin-Key":adminKeyForRequest(request)||""}});const text=await r.text();return new Response(text,{status:r.status,headers:{"Content-Type":r.headers.get("content-type")||"application/json; charset=utf-8","Cache-Control":"no-store"}})}catch(error){console.error("Admin indexer proxy failed:",error);return Response.json({error:"backend_unreachable"},{status:502})}}

