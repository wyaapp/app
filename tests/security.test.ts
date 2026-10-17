import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createAccountAuth} from '../lib/auth/config.ts';
import {createMailGuard, verifyTurnstile} from '../lib/auth/mail-guard.ts';
import {createSpaceService} from '../lib/space-service.ts';
import {createPictureService} from '../lib/picture-service.ts';
import {readText,boundedAuthRequest,AUTH_BODY_LIMIT} from '../lib/request-body.ts';
import {secureResponse} from '../deployment/request-boundary.ts';

const origin='https://wya.example.test';
function fixture(applySecurity=true) {
  const sqlite=new DatabaseSync(':memory:');
  for(const migration of ['0000_dapper_morlocks','0001_auth','0002_spaces','0003_reclaimable_handles','0004_profile_pictures',...(applySecurity?['0005_security_limits']:[])]) sqlite.exec(readFileSync(`drizzle/${migration}.sql`,'utf8'));
  const prepare=(sql:string)=>{
    let args:SQLInputValue[]=[];
    const s={bind(...values:SQLInputValue[]){args=values;return s;},async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return s.execute();},execute(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};
    return s;
  };
  const db={prepare,async batch(statements:ReturnType<typeof prepare>[]){sqlite.exec('BEGIN');try{const results=statements.map(s=>s.execute());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}} as unknown as D1Database;
  let now=Date.now(),ip=1;
  const emails:{email:string;code:string}[]=[];
  const state={failDelivery:false,challenge:true,hold:undefined as Promise<void>|undefined,onDelivery:undefined as (()=>void)|undefined};
  const guard=createMailGuard(db,async()=>{if(!state.challenge)throw new Error('Invalid challenge');},()=>now);
  const auth=createAccountAuth(sqlite,randomBytes(32).toString('hex'),origin,async(email,code)=>{state.onDelivery?.();if(state.hold)await state.hold;if(state.failDelivery)throw new Error('Provider failure');emails.push({email,code});},guard);
  const request=(path:string,body:unknown)=>auth.handler(new Request(origin+'/api/auth/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','cf-connecting-ip':`192.0.2.${ip++}`},body:JSON.stringify(body)}));
  const send=(email:string)=>request('email-otp/send-verification-otp',{email,type:'sign-in'});
  return {db,sqlite,emails,state,send,request,spaces:createSpaceService(db,()=>now),advance:(ms:number)=>{now+=ms;}};
}

test('blocked resend preserves a delivered code; provider failure is not reported as success',async()=>{
  const f=fixture(),email='alice@example.test';
  assert.equal((await f.send(email)).status,200);
  const original=f.emails[0].code;
  const blocked=await f.send(email);assert.equal(blocked.status,429);assert.equal((await blocked.json() as {code:string}).code,'OTP_ACTIVE');
  assert.equal(f.emails.length,1);
  assert.equal((await f.request('sign-in/email-otp',{email,otp:original})).status,200);
  f.state.failDelivery=true;
  assert.equal((await f.send('failed@example.test')).status,503);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM verification WHERE identifier='sign-in-otp-failed@example.test'").get()!.n,0);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM auth_mail_locks').get()!.n,0);
  f.advance(61_000);f.state.failDelivery=false;
  assert.equal((await f.send('failed@example.test')).status,200);
});

test('concurrent sends cannot replace an in-flight challenge',{timeout:10_000},async()=>{
  const f=fixture();let finish!:()=>void;
  const deliveryStarted=new Promise<void>(resolve=>{f.state.onDelivery=resolve;});
  f.state.hold=new Promise<void>(resolve=>{finish=resolve;});
  const first=f.send('race@example.test');
  // Synchronize on the pending delivery, independent of runner scheduling speed.
  try {
    await Promise.race([deliveryStarted,first.then(()=>{throw new Error('First send finished before reaching delivery');})]);
    assert.ok(f.sqlite.prepare("SELECT id FROM verification WHERE identifier='sign-in-otp-race@example.test'").get());
    assert.equal((await f.send('race@example.test')).status,429);
  } finally {finish();}
  assert.equal((await first).status,200);
  assert.equal(f.emails.length,1);
  assert.equal((await f.request('sign-in/email-otp',{email:'race@example.test',otp:f.emails[0].code})).status,200);
});

test('signup budget cannot spend the reserved existing-account allowance',async()=>{
  const f=fixture(),email='existing@example.test';
  assert.equal((await f.send(email)).status,200);
  assert.equal((await f.request('sign-in/email-otp',{email,otp:f.emails[0].code})).status,200);
  for(let i=0;i<29;i++) assert.equal((await f.send(`new${i}@example.test`)).status,200);
  assert.equal((await f.send('over-budget@example.test')).status,429);
  assert.equal(f.emails.length,30);
  f.advance(61_000);
  assert.equal((await f.send(email)).status,200);
  assert.equal(f.emails.length,31);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM verification WHERE identifier='sign-in-otp-over-budget@example.test'").get()!.n,0);
});

test('failed bot verification does not create an OTP or consume mail allowance',async()=>{
  const f=fixture();f.state.challenge=false;
  assert.notEqual((await f.send('bot@example.test')).status,200);
  assert.equal(f.emails.length,0);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM auth_mail_limits').get()!.n,0);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM verification').get()!.n,0);
});

test('Turnstile is fail-closed and verifies success, hostname and action',async()=>{
  const headers=new Headers({'cf-turnstile-response':'local-fixture-token'});
  const response=(body:unknown)=>async()=>Response.json(body);
  await assert.rejects(verifyTurnstile(undefined,origin,headers));
  await assert.rejects(verifyTurnstile('secret',origin,new Headers()));
  for(const result of [{success:false},{success:true,hostname:'evil.example',action:'login'},{success:true,hostname:'wya.example.test',action:'other'}]) {
    await assert.rejects(verifyTurnstile('secret',origin,headers,response(result)));
  }
  await verifyTurnstile('secret',origin,headers,response({success:true,hostname:'wya.example.test',action:'login'}));
  await assert.rejects(verifyTurnstile('secret',origin,headers,async()=>{throw new Error('offline');}));
});

function streamed(size:number,headers:Record<string,string>={}) {
  let read=0,cancelled=false;
  const body=new ReadableStream({pull(c){if(read===size){c.close();return;}const count=Math.min(4096,size-read);c.enqueue(new Uint8Array(count).fill(32));read+=count;},cancel(){cancelled=true;}});
  const request=new Request(origin+'/api/account',{method:'POST',headers,body,duplex:'half'} as RequestInit);
  return {request,stats:()=>({read,cancelled})};
}
test('JSON and auth bounds stop reading early, including missing and dishonest lengths',async()=>{
  for(const headers of [{},{'content-length':'1'}] as Record<string,string>[]) {
    const f=streamed(1024*1024,headers);
    await assert.rejects(readText(f.request),{status:413});
    assert.equal(f.stats().cancelled,true);assert.ok(f.stats().read<=16_000+8192);
  }
  const auth=streamed(1024*1024);
  await assert.rejects(boundedAuthRequest(auth.request),{status:413});
  assert.ok(auth.stats().read<=AUTH_BODY_LIMIT+8192);assert.equal(auth.stats().cancelled,true);
  const unicode=new Request(origin,{method:'POST',body:'😀'.repeat(5000)});
  await assert.rejects(readText(unicode),{status:413});
  const exact=new Request(origin,{method:'POST',body:'x'.repeat(16_000)});
  assert.equal((await readText(exact)).length,16_000);
  const form=new Request(origin+'/api/auth/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:'local=test'},body:'grant_type=refresh_token&refresh_token=local'});
  const bounded=await boundedAuthRequest(form);
  assert.equal(bounded.headers.get('cookie'),'local=test');assert.equal((await bounded.formData()).get('grant_type'),'refresh_token');
});

test('no-op saves create no revisions; retained history is capped and stale restores fail',async()=>{
  const f=fixture();let p=await f.spaces.mutate('alice',{action:'create_profile',handle:'alice',name:'Alice'});
  const same=await f.spaces.mutate('alice',{action:'update_profile',expectedVersion:p.version,bio:p.bio});
  assert.equal(same.version,p.version);assert.equal((await f.spaces.getHistory('alice')).length,0);
  for(let i=0;i<65;i++) {f.advance(61_000);p=await f.spaces.mutate('alice',{action:'update_profile',expectedVersion:p.version,bio:`revision ${i}`});}
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM space_revisions').get()!.n,50);
  assert.equal((await f.spaces.getHistory('alice')).length,50);
  await assert.rejects(f.spaces.mutate('alice',{action:'restore_revision',expectedVersion:p.version,revision:1}),{status:404});
});

test('write budget applies to unchanged saves and is shared with picture mutations',async()=>{
  const f=fixture();const p=await f.spaces.mutate('alice',{action:'create_profile',handle:'alice',name:'Alice'});
  const competing=await Promise.allSettled(Array.from({length:40},()=>f.spaces.mutate('alice',{action:'update_profile',expectedVersion:p.version,bio:p.bio})));
  assert.equal(competing.filter(result=>result.status==='fulfilled').length,29);
  assert.equal(competing.filter(result=>result.status==='rejected' && result.reason.status===429).length,11);
  await assert.rejects(f.spaces.mutate('alice',{action:'update_profile',expectedVersion:p.version,bio:p.bio}),{status:429});
  const pictures=createPictureService(f.db,{} as R2Bucket);
  await assert.rejects(pictures.remove('alice',p.id,p.version),{status:429});
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM space_revisions').get()!.n,0);
});

test('private-page framing headers preserve cookies and existing image sandbox headers',()=>{
  for(const path of ['/sign-in','/dashboard','/consent','/connections','/api/auth/get-session']) {
    const response=secureResponse(new Request(origin+path),new Response('private',{headers:{'Set-Cookie':'session=test; HttpOnly'}}));
    assert.equal(response.headers.get('x-frame-options'),'DENY');assert.ok(response.headers.get('content-security-policy')!.includes("frame-ancestors 'none'"));
    assert.equal(response.headers.get('cache-control'),'private, no-store');assert.ok(response.headers.get('set-cookie')!.includes('session=test'));
  }
  const picture=secureResponse(new Request(origin+'/api/pictures/local'),new Response(null,{headers:{'Content-Security-Policy':"default-src 'none'; sandbox"}}));
  assert.equal(picture.headers.get('content-security-policy'),"default-src 'none'; sandbox");
});


test('security migration trims existing history while preserving current content and the newest 50 revisions',()=>{
  const f=fixture(false);
  const data=JSON.stringify({name:'Alice',bio:'Current',theme:'lime',links:[]});
  f.sqlite.prepare('INSERT INTO spaces (id,user_id,handle,data,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('local-space','alice','alice',data,66,'2026-01-01','2026-01-02');
  for(let version=1;version<=65;version++) f.sqlite.prepare('INSERT INTO space_revisions (id,space_id,version,data,reason,created_at) VALUES (?,?,?,?,?,?)').run(`local-${version}`,'local-space',version,data,'Local test','2026-01-01');
  f.sqlite.exec(readFileSync('drizzle/0005_security_limits.sql','utf8'));
  const history=f.sqlite.prepare('SELECT count(*) AS count,min(version) AS oldest,max(version) AS newest FROM space_revisions').get()!;
  assert.equal(history.count,50);assert.equal(history.oldest,16);assert.equal(history.newest,65);
  const current=f.sqlite.prepare('SELECT data,version FROM spaces').get()!;assert.equal(current.data,data);assert.equal(current.version,66);
});
