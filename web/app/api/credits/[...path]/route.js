import {proxyCredits} from '../../../../lib/creditProxy';
export async function POST(request,{params}){const{path}=await params;if(path.length!==1||!['login','logout','wallet','order'].includes(path[0]))return Response.json({error:'not_found'},{status:404});return proxyCredits(request,`/${path[0]}`);}
