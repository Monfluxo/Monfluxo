import { getTransactionsForAddress, getTransaction } from "./helius.js";
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
    if(!ins.length||parsed?.type==="BUY"||parsed?.type==="CREATOR_FEE_CLAIM") continue;
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
  console.log("SOL change: "+x.solChange+" | fee: "+x.fee);
  const keys=[...(x.tx?.transaction?.message?.accountKeys||[])].map(keyValue);
  const wi=keys.indexOf(address);
  const pre=wi>=0?BigInt(x.tx?.meta?.preBalances?.[wi]||0):0n;
  const post=wi>=0?BigInt(x.tx?.meta?.postBalances?.[wi]||0):0n;
  const gross=-(post-pre+BigInt(x.tx?.meta?.fee||0));
  console.log("walletIndex: "+wi+" | gross SOL input: "+(Number(gross)/1e9));
  const allTokenBalances = [
    ...(x.tx?.meta?.preTokenBalances || []).map(b => ({...b, side:"pre"})),
    ...(x.tx?.meta?.postTokenBalances || []).map(b => ({...b, side:"post"}))
  ].filter(b => b?.owner === address && b?.mint && b.mint !== WSOL_MINT);

  const tokenSummary = new Map();
  for (const b of allTokenBalances) {
    const key = b.mint;
    const current = tokenSummary.get(key) || { pre: 0n, post: 0n, decimals: b.uiTokenAmount?.decimals ?? 0 };
    const amount = BigInt(b.uiTokenAmount?.amount || "0");
    if (b.side === "pre") current.pre += amount;
    else current.post += amount;
    tokenSummary.set(key, current);
  }

  console.log("token deltas:");
  for (const [mint, v] of tokenSummary) {
    const delta = v.post - v.pre;
    if (delta !== 0n) {
      console.log("  "+mint+" | "+(Number(delta)/10**v.decimals)+" tokens | raw "+delta.toString());
    }
  }

  const splTransfers = [];
  const addSpl = (instruction) => {
    const parsed = instruction?.parsed;
    const info = parsed?.info;
    const program = instruction?.program || instruction?.programId;
    if (
      (program === "spl-token" || program === "spl-token-2022" ||
       program === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ||
       program === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPXxuEb") &&
      (parsed?.type === "transfer" || parsed?.type === "transferChecked") &&
      info?.source && info?.destination
    ) {
      splTransfers.push({
        source: info.source,
        destination: info.destination,
        amount: String(info.amount ?? info.tokenAmount?.amount ?? "0"),
        mint: info.mint || info.tokenAmount?.mint || null
      });
    }
  };
  for (const ix of x.tx?.transaction?.message?.instructions || []) addSpl(ix);
  for (const group of x.tx?.meta?.innerInstructions || [])
    for (const ix of group.instructions || []) addSpl(ix);

  console.log("account keys:");
  const debugKeys = [
    ...(x.tx?.transaction?.message?.accountKeys || []),
    ...(x.tx?.meta?.loadedAddresses?.writable || []),
    ...(x.tx?.meta?.loadedAddresses?.readonly || [])
  ];
  debugKeys.forEach((k, idx) => console.log("  ["+idx+"] "+keyValue(k)));

  console.log("instruction flow:");
  const summarizeIx = (ix, where) => {
    const parsed = ix?.parsed;
    const info = parsed?.info;
    const accountKeysForDebug = [
      ...(x.tx?.transaction?.message?.accountKeys || []),
      ...(x.tx?.meta?.loadedAddresses?.writable || []),
      ...(x.tx?.meta?.loadedAddresses?.readonly || [])
    ];
    const resolvedProgram =
      ix?.programId ||
      ix?.program ||
      keyValue(accountKeysForDebug[ix?.programIdIndex]);
    const program = resolvedProgram || "?";
    if (parsed) {
      console.log("  "+where+" | "+program+" | "+(parsed.type || "?")+" | "+JSON.stringify(info || {}));
    } else {
      const raw = {
        programId: ix?.programId || null,
        programIdIndex: ix?.programIdIndex ?? null,
        accounts: ix?.accounts || null,
        data: ix?.data || null
      };
      console.log("  "+where+" | "+program+" | raw | "+JSON.stringify(raw));
    }
  };
  for (const [j, ix] of (x.tx?.transaction?.message?.instructions || []).entries()) {
    summarizeIx(ix, "outer["+j+"]");
  }
  for (const group of x.tx?.meta?.innerInstructions || []) {
    for (const [j, ix] of (group.instructions || []).entries()) {
      summarizeIx(ix, "inner["+group.index+":"+j+"]");
    }
  }

  console.log("SPL transfers involving wallet:");
  for (const t of splTransfers) {
    if (t.source === address || t.destination === address) {
      console.log("  "+t.source+" -> "+t.destination+" | "+t.amount+" | "+(t.mint || "?"));
    }
  }
  // Canonical jsonParsed RPC inspection for the candidate.
  try {
    const parsedTx = await getTransaction(signatureOf(x.tx));
    console.log("canonical jsonParsed instruction flow:");
    for (const [j, ix] of (parsedTx?.transaction?.message?.instructions || []).entries()) {
      console.log(
        "  outer["+j+"] | program="+(ix?.program || ix?.programId || "?")+
        " | type="+(ix?.parsed?.type || "raw")+
        " | info="+JSON.stringify(ix?.parsed?.info || {})+
        (ix?.data ? " | data="+ix.data : "")
      );
    }
    for (const group of parsedTx?.meta?.innerInstructions || []) {
      for (const [j, ix] of (group.instructions || []).entries()) {
        console.log(
          "  inner["+group.index+":"+j+"] | program="+(ix?.program || ix?.programId || "?")+
          " | type="+(ix?.parsed?.type || "raw")+
          " | info="+JSON.stringify(ix?.parsed?.info || {})+
          (ix?.data ? " | data="+ix.data : "")
        );
      }
    }
  } catch (error) {
    console.log("canonical jsonParsed inspection failed: "+error.message);
  }

}
