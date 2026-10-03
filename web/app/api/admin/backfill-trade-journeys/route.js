const BACKEND_BASE=process.env.MONFLUXO_BACKEND_URL||"http://127.0.0.1:3000";
async function proxy(request,method){try{const key=request.headers.get("x-monfluxo-admin-key")||"";const r=await fetch(`${BACKEND_BASE}/api/admin/backfill-trade-journeys`,{method,cache:"no-store",headers:{"X-Monfluxo-Admin-Key":key}});const text=await r.text();return new Response(text,{status:r.status,headers:{"Content-Type":r.headers.get("content-type")||"application/json; charset=utf-8","Cache-Control":"no-store"}})}catch(error){console.error("Trade Journey backfill proxy failed:",error);return Response.json({error:"backend_unreachable"},{status:502})}}
export async function GET(request){return proxy(request,"GET")}
export async function POST(request){return proxy(request,"POST")}
