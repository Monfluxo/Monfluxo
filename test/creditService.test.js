import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {bearer,hashCredential,currentAccount,assertCreditAccess,loginCredits,creditSummary,requestCreditWallet} from '../src/creditService.js';
const token='a'.repeat(43),req={headers:{authorization:`Bearer ${token}`}};
function mockFetch(t,fn){const original=globalThis.fetch;globalThis.fetch=async(url,options)=>Response.json(await fn(String(url),options));t.after(()=>{globalThis.fetch=original;});}
test('credentials reject malformed bearer tokens and hash private codes',()=>{
 assert.equal(bearer(req),token);assert.equal(bearer({headers:{authorization:'Bearer service-role'}}),null);assert.equal(hashCredential('secret').length,64);assert.notEqual(hashCredential('secret'),'secret');
});
test('missing session cannot reach account storage',async t=>{
 mockFetch(t,()=>{throw Error('No storage expected')});await assert.rejects(currentAccount({headers:{}}),e=>e.statusCode===401);
});
test('account authorization rejects disabled and expired accounts',async t=>{
 let account={id:'id',expires_at:'2000-01-01',disabled:true};mockFetch(t,url=>url.includes('credit_sessions')?[{account_id:'id'}]:[account]);
 await assert.rejects(currentAccount(req),e=>e.code==='account_disabled');account.disabled=false;
 await assert.rejects(currentAccount(req,{active:true}),e=>e.code==='subscription_expired');assert.equal((await currentAccount(req)).id,'id');
});
test('unlocked read verifies session and account then requires matching wallet entitlement',async t=>{
 const original=process.env.MONFLUXO_CREDITS_ENABLED;process.env.MONFLUXO_CREDITS_ENABLED='true';t.after(()=>{if(original===undefined)delete process.env.MONFLUXO_CREDITS_ENABLED;else process.env.MONFLUXO_CREDITS_ENABLED=original});
 let access=[];mockFetch(t,url=>url.includes('credit_sessions')?[{account_id:'id'}]:url.includes('credit_accounts')?[{id:'id',expires_at:'2099-01-01'}]:access);
 await assert.rejects(assertCreditAccess(req,'wallet'),e=>e.code==='wallet_unlock_required'&&e.statusCode===402);access=[{kind:'unlock'}];assert.equal((await assertCreditAccess(req,'wallet')).id,'id');
});
test('balance subtracts reservations and expiry hides every spendable credit',async t=>{
 mockFetch(t,url=>url.includes('credit_requests')?[{reserved:3,charged:1}]:[]);
 const account={id:'id',label:'Beta',plan:'beta',cycle_credits:21,bonus_credits:10,expires_at:'2099-01-01'};
 const s=await creditSummary(account);assert.equal(s.available,29);assert.equal(s.reserved,2);assert.equal(s.cycleTotal,50);
 const expired=await creditSummary({...account,expires_at:'2000-01-01'});assert.equal(expired.available,0);assert.equal(expired.bonus,0);
});
test('invalid invitation never reaches database',async t=>{mockFetch(t,()=>{throw Error('No storage expected')});await assert.rejects(loginCredits('bad'),e=>e.statusCode===401)});
test('API blocks wallet dashboard, progress, incoming, creator and trade detail before reaching data services',async()=>{
 const source=readFileSync(new URL('../src/httpApi.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
 const context=vm.createContext({process:{env:{},argv:[]},URL,console,creditsEnabled:()=>true,assertCreditAccess:async()=>{throw Object.assign(Error('Invitation required'),{code:'invitation_required',statusCode:401})}});
 const handle=vm.runInContext(source+'\nhandleRequest',context);
 for(const path of ['wallet','wallet-progress','incoming-flows','creator-revenue','data/trade']){let status;await handle({method:'GET',url:`/api/${path}/wallet${path==='data/trade'?'/mint':''}`,headers:{}},{writeHead(s){status=s},end(){}});assert.equal(status,401);}
});
function proxyContext(fetch){const source=readFileSync(new URL('../web/lib/creditProxy.js',import.meta.url),'utf8').replace(/export /g,'');return vm.runInContext(source+'\n({sameOrigin,creditHeaders,proxyCredits})',vm.createContext({process:{env:{NODE_ENV:'production'}},URL,Response,AbortSignal,fetch}));}
test('credit proxy accepts public host behind reverse proxy and rejects foreign or absent origins',()=>{
 const p=proxyContext(()=>{throw Error('No fetch expected')});const request=(origin)=>({url:'http://internal:8080/api/credits/login',headers:new Headers({host:'monfluxo.example',...(origin?{origin}:{})})});
 assert.equal(p.sameOrigin(request('https://monfluxo.example')),true);assert.equal(p.sameOrigin(request('https://attacker.example')),false);assert.equal(p.sameOrigin(request(null)),false);
});
test('login keeps session out of JSON and sets a secure HttpOnly cookie',async()=>{
 const p=proxyContext(async()=>Response.json({token}));const r=await p.proxyCredits({method:'POST',url:'https://monfluxo.example/api/credits/login',headers:new Headers({host:'monfluxo.example',origin:'https://monfluxo.example'}),text:async()=>JSON.stringify({code:'private'})},'/login');
 assert.deepEqual(await r.json(),{ok:true});assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.match(r.headers.get('set-cookie'),/; Secure$/);assert.equal(r.headers.get('cache-control'),'no-store');
});
test('proxy forwards only a well-formed session token from the private cookie',()=>{
 const p=proxyContext(()=>{});assert.equal(p.creditHeaders({headers:new Headers({cookie:`other=value; mf_session=${token}`})}).Authorization,`Bearer ${token}`);assert.deepEqual({...p.creditHeaders({headers:new Headers({cookie:'mf_session=invalid'})})},{});
});

test('wallet extensions reject arbitrary blocks before storage or indexing',async t=>{mockFetch(t,()=>{throw Error('No storage expected')});for(const extend of [10000,2001,-2,'2000',null])await assert.rejects(requestCreditWallet(req,'wallet',extend),e=>e.code==='invalid_request'&&e.statusCode===400);});
