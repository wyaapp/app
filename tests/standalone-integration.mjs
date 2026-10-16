// Local-only: creates test identities directly through the real auth library,
// with an in-memory email sink, then exercises the built Worker over HTTP.
import assert from 'node:assert/strict';
import {getPlatformProxy} from 'wrangler';
import {readFileSync} from 'node:fs';
import {get as httpGet} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {createAccountAuth} from '../lib/auth/config.ts';
const origin='http://127.0.0.1:8787';
const variables=parseEnv(readFileSync('.dev.vars','utf8'));
const proxy=await getPlatformProxy({configPath:'.cloudflare/wrangler.json',persist:{path:'.cloudflare/.wrangler/state/v3'},envFiles:['.dev.vars']});
try {
  const pending=new Map();
  const auth=createAccountAuth(proxy.env.DB,variables.BETTER_AUTH_SECRET,origin,async(email,code)=>{pending.set(email,code);});
  const suffix=Date.now().toString(36);
  async function login(email) {
    const send=await auth.handler(new Request(origin+'/api/auth/email-otp/send-verification-otp',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','cf-connecting-ip':`192.0.2.${Date.now()%250+1}`},body:JSON.stringify({email,type:'sign-in'})}));
    assert.equal(send.status,200,await send.text());
    // The Worker consumes the real code from local D1 and creates its own session.
    const result=await fetch(origin+'/api/auth/sign-in/email-otp',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,otp:pending.get(email)})});
    assert.equal(result.status,200,await result.clone().text());
    return result.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  }
  const request=(path,options={})=>fetch(origin+path,{redirect:'manual',...options});
  const alice=await login(`alice-${suffix}@example.test`);
  const bob=await login(`bob-${suffix}@example.test`);
  assert.equal((await request('/')).status,200);
  assert.equal((await request('/sign-in')).status,200);
  assert.equal((await request('/dashboard')).status,307);
  assert.equal((await request('/api/account',{headers:{'oai-authenticated-user-id':'victim','oai-authenticated-user-email':'victim@example.test'}})).status,401);
  const write=(cookie,body)=>request('/api/account',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  let response=await write(alice,{action:'create_profile',handle:`qa-${suffix}`,name:'Local QA'});assert.equal(response.status,200,await response.text());
  response=await write(alice,{action:'upsert_link',expectedVersion:1,slug:'github',label:'Code',platform:'github',destination:'alexcastro'});assert.equal(response.status,200);
  assert.equal((await request(`/qa-${suffix}/github`)).headers.get('location'),'https://github.com/alexcastro');
  const other=await (await request('/api/account',{headers:{Cookie:bob}})).json();assert.equal(other.profile,null);
  const privatePage=await request('/dashboard',{headers:{Cookie:alice}});assert.equal(privatePage.status,200);
  const metadata=await request('/.well-known/oauth-protected-resource');assert.equal(metadata.status,200);assert.equal((await metadata.json()).resource,origin+'/mcp');
  const discovery=await request('/.well-known/oauth-authorization-server/api/auth');assert.equal(discovery.status,200);
  const denied=await request('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Cookie:alice},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  assert.equal(denied.status,401,'MCP requires an OAuth token, never a browser cookie');assert.ok(denied.headers.get('www-authenticate'));
  const jsonHeaders={'Content-Type':'application/json',Origin:origin};
  const register=await request('/api/auth/oauth2/register',{method:'POST',headers:jsonHeaders,body:JSON.stringify({client_name:'Local ChatGPT test',redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],scope:'profile:read profile:write offline_access'})});
  const client=await register.json();assert.equal(register.status,201,JSON.stringify(client));
  const verifier=randomBytes(32).toString('base64url');
  const query=new URLSearchParams({client_id:client.client_id,redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',response_type:'code',scope:'profile:read profile:write offline_access',resource:origin+'/mcp',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state:'local-test'});
  const authorize=await new Promise((resolve,reject)=>{
    httpGet(origin+'/api/auth/oauth2/authorize?'+query,{headers:{Cookie:alice,Accept:'text/html','Sec-Fetch-Mode':'navigate'}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    }).on('error',reject);
  });
  assert.equal(authorize.status,302,await authorize.clone().text());
  const consentUrl=new URL(authorize.headers.get('location'),origin);
  console.log('OAuth consent path:',consentUrl.pathname);
  const consentHtml=await (await request(consentUrl.pathname+consentUrl.search,{headers:{Cookie:alice}})).text();
  assert.ok(consentHtml.includes('Local ChatGPT test'),consentHtml.match(/<main[\s\S]*?<\/main>/)?.[0] || consentHtml.slice(0,300));assert.ok(consentHtml.includes('Allow access'));
  const consent=await request('/api/auth/oauth2/consent',{method:'POST',headers:{...jsonHeaders,Cookie:alice},body:JSON.stringify({accept:true,oauth_query:consentUrl.search.slice(1)})});
  const decision=await consent.json();assert.equal(consent.status,200,JSON.stringify(decision));
  const token=await request('/api/auth/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:query.get('redirect_uri'),code:new URL(decision.url).searchParams.get('code'),code_verifier:verifier,resource:origin+'/mcp'})});
  const tokens=await token.json();assert.equal(token.status,200,JSON.stringify(tokens));
  const rpc=(name,args={})=>request('/mcp',{method:'POST',headers:{...jsonHeaders,Authorization:'Bearer '+tokens.access_token},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
  const read=await rpc('get_profile');const readBody=await read.json();assert.equal(read.status,200,JSON.stringify(readBody));
  assert.equal(JSON.parse(readBody.result.content[0].text).profile.handle,`qa-${suffix}`);
  const edit=await rpc('update_profile',{expectedVersion:2,bio:'Edited through local MCP'});const editBody=await edit.json();assert.equal(edit.status,200,JSON.stringify(editBody));
  assert.equal(JSON.parse(editBody.result.content[0].text).profile.bio,'Edited through local MCP');
  const grants=await (await request('/api/auth/oauth2/get-consents',{headers:{Cookie:alice}})).json();
  const disconnect=await request('/api/auth/oauth2/delete-consent',{method:'POST',headers:{...jsonHeaders,Cookie:alice},body:JSON.stringify({id:grants[0].id})});assert.equal(disconnect.status,200);
  assert.equal((await rpc('get_profile')).status,401,'Disconnected tokens cannot read the account');
  console.log('Standalone Worker checks passed: D1 email sign-in, dashboard, forged headers, isolation, redirects, OAuth discovery, consent, authenticated MCP read/edit, and disconnect.');
} finally {await proxy.dispose();}
