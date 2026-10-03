"use client";
import {useState} from "react";
export default function WalletPolicyControls({adminKey}) {
  const [wallet,setWallet]=useState(""),[action,setAction]=useState("block"),[reason,setReason]=useState(""),[limit,setLimit]=useState(5000),[result,setResult]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function call(method) {
    setBusy(true);setError("");setResult(null);
    try {
      const url="/api/admin/wallet-policy"+(method==="GET"?`?wallet=${encodeURIComponent(wallet.trim())}`:"");
      const r=await fetch(url,{method,cache:"no-store",headers:{"Content-Type":"application/json","X-Monfluxo-Admin-Key":adminKey.trim()},...(method==="POST"?{body:JSON.stringify({wallet:wallet.trim(),action,reason,transactionLimit:Number(limit)})}:{})});
      const p=await r.json();if(!r.ok)throw new Error(p.message||p.error||"Policy request failed");setResult(p.policy);
      if(method==="GET"&&p.policy){setAction(p.policy.action);setReason(p.policy.reason||"");setLimit(p.policy.transaction_limit||5000)}
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="admin-panel"><h2>Wallet restrictions & analysis limits</h2><p>Use the admin key above. Blocks stop analysis; exclusions hide wallets from Trade Intelligence rankings. High activity requires review and does not imply a bot.</p><div className="backfill-controls"><input aria-label="Wallet address" value={wallet} onChange={e=>setWallet(e.target.value)} placeholder="Solana wallet address"/><select aria-label="Wallet restriction" value={action} onChange={e=>setAction(e.target.value)}><option value="block">Block analysis</option><option value="exclude">Exclude from ranking</option><option value="review">Require review</option><option value="allow">Allow analysis</option></select><input aria-label="Transaction budget" type="number" min="5000" max="50000" step="2000" value={limit} onChange={e=>setLimit(e.target.value)}/><input aria-label="Restriction reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={300} placeholder="Reason for this policy"/><button disabled={busy||!adminKey.trim()||!wallet.trim()} onClick={()=>call("GET")}>Check wallet</button><button disabled={busy||!adminKey.trim()||!wallet.trim()||!reason.trim()} onClick={()=>call("POST")}>Save policy</button></div>{error?<div className="admin-error">{error}</div>:null}{result?<p role="status">Saved policy: {result.action} · {Number(result.transaction_limit).toLocaleString()} transaction limit · {result.reason}</p>:null}<p>Credit model prepared: 3 credits / first 5,000 new transactions; 1 / each additional 2,000; Pro: 30 / month. Billing is disabled until authenticated accounts and a credit ledger are connected. To resume approved history, raise the budget and analyze the wallet again.</p></section>;
}
