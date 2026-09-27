import { getTransactionsForAddress } from "./helius.js";
import { parseSwapTransaction } from "./swapParser.js";
import { getTradeSamples } from "./db.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const TARGET_COUNT = 5;

let address = process.argv[2];
if (!address) address = (await getTradeSamples(1))[0]?.wallet_address || null;
if (!address) process.exit(1);

function keyValue(k) { return typeof k === "string" ? k : k?.pubkey || k?.address || null; }
function signatureOf(tx) { return tx?.transaction?.signatures?.[0] || tx?.signature || null; }

function inflows(tx) {
  const pre = new Map(), post = new Map();
  for (const b of tx?.meta?.preTokenBalances || [])
    if (b?.owner === address && b?.mint) pre.set(b.mint, (pre.get(b.mint)||0n)+BigInt(b.uiTokenAmount?.amount||"0"));
  for (const b of tx?.meta?.postTokenBalances || [])
    if (b?.owner === address && b?.mint) post.set(b.mint, (post.get(b.mint)||0n)+BigInt(b.uiTokenAmount?.amount||"0"));
  const out=[];
  for (const mint of new Set([...pre.keys(),...post.keys()])) {
    if (mint===WSOL_MINT) continue;
    const d=(post.get(mint)||0n)-(pre.get(mint)||0n);
    if(d>0n) {
      const b=[...(tx?.meta?.postTokenBalances||[]),...(tx?.meta?.preTokenBalances||[])]
        .find(x=>x?.owner===address&&x?.mint===mint);
      out.push({mint,amount:Number(d)/10**(b?.uiTokenAmount?.decimals||0)});
    }
  }
  return out;
}

function programs(tx) {
  const keys=[...(tx?.transaction?.message?.accountKeys||[]),...(tx?.meta?.loadedAddresses?.writable||[]),...(tx?.meta?.loadedAddresses?.readonly||[])].map(keyValue);
  const ids=new Set();
  const add=ix=>{const id=ix?.programId||ix?.program||keyValue(keys[ix?.programIdIndex]);if(id)ids.add(id)};
  (tx?.transaction?.message?.instructions||[]).forEach(add);
  for(const g of tx?.meta?.innerInstructions||[]) (g.instructions||[]).forEach(add);
  return [...ids];
}

const wanted = new Set([
  "675kPX9MHTjS2zt1qfr1NYHuZeLXfQM9H24yFSUt1Mp8",
  "proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
]);

let token=null, pages=0, found=[];
while(pages<Number(process.env.MAX_DEEP_PAGES||500)&&found.length<TARGET_COUNT){
  pages++;
  const r=await getTransactionsForAddress(address,token);
  for(const tx of r?.data||[]){
    const ins=inflows(tx), parsed=parseSwapTransaction(tx,address);
    if(!ins.length||parsed?.type==="BUY") continue;
    const p=programs(tx);
    const relevant=p.filter(x=>wanted.has(x));
    const keys=[...(tx?.transaction?.message?.accountKeys||[])].map(keyValue);
    const wi=keys.indexOf(address);
    const pre=wi>=0?BigInt(tx?.meta?.preBalances?.[wi]||0):0n;
    const post=wi>=0?BigInt(tx?.meta?.postBalances?.[wi]||0):0n;
    const fee=BigInt(tx?.meta?.fee||0);
    const solChange=Number(post-pre)/1e9;
    found.push({tx,ins,parsed,relevant,solChange,fee:Number(fee)/1e9});
    if(found.length>=TARGET_COUNT) break;
  }
  token=r?.paginationToken||null;
  if(!token)break;
}

console.log("Wallet: "+address);
console.log("Found: "+found.length+" | pages: "+pages);
for(const [i,x] of found.entries()){
  console.log("\n#"+(i+1));
  console.log("sig: "+signatureOf(x.tx));
  console.log("time: "+(x.tx?.blockTime?new Date(x.tx.blockTime*1000).toISOString():"?"));
  console.log("in: "+x.ins.map(v=>v.amount+" "+v.mint).join(" | "));
  console.log("parser: "+JSON.stringify(x.parsed));
  console.log("programs: "+(x.relevant.length?x.relevant.join(", "):"none"));
  console.log("SOL change: "+x.solChange+" | fee: "+x.fee);\n  const keys=[...(x.tx?.transaction?.message?.accountKeys||[])].map(keyValue);\n  const wi=keys.indexOf(address);\n  const pre=wi>=0?BigInt(x.tx?.meta?.preBalances?.[wi]||0):0n;\n  const post=wi>=0?BigInt(x.tx?.meta?.postBalances?.[wi]||0):0n;\n  const gross=-(post-pre+BigInt(x.tx?.meta?.fee||0));\n  console.log("walletIndex: "+wi+" | gross SOL input: "+(Number(gross)/1e9));
}
