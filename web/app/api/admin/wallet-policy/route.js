const BACKEND_BASE=process.env.MONFLUXO_BACKEND_URL||"http://127.0.0.1:3000";
async function proxy(request,method){
  try{
    const query=method==="GET"?`?wallet=${encodeURIComponent(new URL(request.url).searchParams.get("wallet")||"")}`:"";
    const body=method==="POST"?await request.text():undefined;
    if(body?.length>8192)return Response.json({error:"request_too_large"},{status:413});
    const r=await fetch(`${BACKEND_BASE}/api/admin/wallet-policy${query}`,{method,body,cache:"no-store",headers:{"Content-Type":"application/json","X-Monfluxo-Admin-Key":request.headers.get("x-monfluxo-admin-key")||""}});
    return new Response(await r.text(),{status:r.status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  }catch{return Response.json({error:"backend_unreachable"},{status:502})}
}
export async function GET(request){return proxy(request,"GET")}
export async function POST(request){return proxy(request,"POST")}
