export function sameOrigin(request){try{const origin=new URL(request.headers.get('origin')||'');return ['http:','https:'].includes(origin.protocol)&&origin.host===(request.headers.get('host')||new URL(request.url).host).toLowerCase();}catch{return false;}}
export function creditHeaders(request){
 const token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('mf_session='))?.slice(11);
 return token&&/^[A-Za-z0-9_-]{43}$/.test(token)?{Authorization:`Bearer ${token}`} : {};
}
export async function proxyCredits(request,path=''){
 if(request.method==='POST'&&!sameOrigin(request))return Response.json({error:'invalid_origin'},{status:403});
 const base=process.env.MONFLUXO_BACKEND_URL||'http://127.0.0.1:3000';
 try{
 const r=await fetch(`${base}/api/credits${path}`,{method:request.method,cache:'no-store',headers:{'Content-Type':'application/json',...creditHeaders(request)},...(request.method==='POST'?{body:await request.text()}:{}),signal:AbortSignal.timeout(20000)});
 const text=await r.text();const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(path==='/login'&&r.ok){const body=JSON.parse(text);if(!/^[A-Za-z0-9_-]{43}$/.test(body.token))throw Error('Invalid session');headers['Set-Cookie']=`mf_session=${body.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`;return Response.json({ok:true},{headers});}
 if(path==='/logout')headers['Set-Cookie']=`mf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`;
 return new Response(text,{status:r.status,headers});
 }catch{return Response.json({error:'backend_unreachable',message:'Credit service is unavailable. Try again shortly.'},{status:502});}
}
