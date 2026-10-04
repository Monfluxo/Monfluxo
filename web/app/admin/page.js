import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {ADMIN_COOKIE,readAdminSession} from '../../lib/adminSession';
import AdminClient from './AdminClient';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false}};
export default async function Admin(){
 const key=readAdminSession((await cookies()).get(ADMIN_COOKIE)?.value);
 if(!key)redirect('/admin/login');
 let allowed=false;
 try{const r=await fetch(`${process.env.MONFLUXO_BACKEND_URL||'http://127.0.0.1:3000'}/api/admin/credits`,{cache:'no-store',headers:{'X-Monfluxo-Admin-Key':key},signal:AbortSignal.timeout(15000)});allowed=r.ok;}catch{}
 if(!allowed)redirect('/admin/login');
 return <AdminClient/>;
}
