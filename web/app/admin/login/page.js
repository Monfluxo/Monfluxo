'use client';
import {useState} from 'react';
import '../admin.css';
export default function AdminLogin(){const[key,setKey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function login(e){e.preventDefault();setBusy(true);setError('');try{const r=await fetch('/api/admin/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});const p=await r.json();if(!r.ok)throw Error(p.error||'Unable to sign in');setKey('');window.location.replace('/admin');}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <main className="admin-shell" style={{maxWidth:520,paddingTop:80}}><header><div><span>MONFLUXO</span><h1>Private administration</h1><p>Authorized access only</p></div></header><section className="admin-panel" style={{padding:24}}><form onSubmit={login}><label htmlFor="admin-password">Administrator key</label><div className="backfill-controls"><input id="admin-password" type="password" autoComplete="current-password" value={key} onChange={e=>setKey(e.target.value)} required maxLength={512}/><button disabled={busy||!key.trim()}>{busy?'Connecting…':'Sign in'}</button></div></form>{error?<p role="alert" className="admin-error">{error}</p>:null}<p>Private session · expires after one hour.</p></section></main>;
}
