import { getChatGPTUser } from '../chatgpt-auth';
import { getAccount, getHistory, mutate } from '@/lib/service';
import { getAuth, isStandalone, authOrigin } from '@/lib/auth/server';
import { requireMcpAuth } from '@better-auth/mcp';
import { createInsufficientScopeError } from 'better-auth/oauth2';
import { AppError } from '@/lib/model';
import { platforms, iconIds } from '@/lib/link-options';
export const dynamic = 'force-dynamic';
const string = {type:'string'};
const expectedVersion = {type:'integer',minimum:1,description:'The version returned by get_profile. Read the current profile before making a change.'};
const definition = (name: string, description: string, properties: Record<string,unknown>, required: string[], destructive = false) => ({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:destructive,idempotentHint:false,openWorldHint:false}});
const tools = [
  {name:'get_profile',description:'Read the authenticated user’s wya.im profile, links, current version, and recent revisions. Never accepts an owner ID; always uses the signed-in account.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  definition('create_profile','Claim a unique wya.im handle and create a profile for the signed-in user. Ask for their desired handle and display name. Handles cannot be renamed in this version.',{handle:string,name:string,bio:string},['handle','name']),
  definition('update_profile','Change the signed-in user’s display name, bio, or color theme. Omitted fields are preserved.',{expectedVersion,name:string,bio:string,theme:{enum:['lilac','lime','ink']}},['expectedVersion']),
  definition('upsert_link','Add or update a named redirect in the signed-in user’s directory. Instagram and GitHub accept a username or URL; other platforms require a full URL. Hidden links are also disabled as redirects. Use the existing slug to replace a link. Choose an icon independently of the platform; omit icon to preserve it, or set null to use the platform default.',{expectedVersion,slug:string,label:string,destination:string,platform:{type:'string',enum:platforms},icon:{type:['string','null'],enum:[...iconIds,null],description:'Optional library icon. Null resets to the platform default; omitted preserves the current icon.'},visible:{type:'boolean',default:true}},['expectedVersion','slug','label','destination','platform']),
  definition('delete_link','Remove a named link from the signed-in user’s profile and disable its redirect. The previous state remains in history.',{expectedVersion,slug:string},['expectedVersion','slug'],true),
  definition('reorder_links','Reorder all the signed-in user’s links. Include every slug exactly once, including hidden links.',{expectedVersion,slugs:{type:'array',items:string}},['expectedVersion','slugs']),
  definition('restore_revision','Restore the signed-in user’s profile and links to a prior revision from get_profile. Replaces current name, bio, theme, and links, while preserving the handle. The current state is also saved to history.',{expectedVersion,revision:{type:'integer',minimum:1}},['expectedVersion','revision'],true),
];
export async function POST(request: Request) {
  if (!isStandalone()) return handle(request);
  const auth = getAuth();
  return requireMcpAuth(auth, async (verifiedRequest, claims) => {
    if (typeof claims.sub !== 'string' || typeof claims.client_id !== 'string') return new Response('Invalid account token', {status:401});
    const {adapter} = await auth.$context;
    const consent = await adapter.findOne<{scopes:string[]}>({model:'oauthConsent',where:[{field:'userId',value:claims.sub},{field:'clientId',value:claims.client_id}]});
    const client = await adapter.findOne<{disabled:boolean}>({model:'oauthClient',where:[{field:'clientId',value:claims.client_id}]});
    if (!consent || !client || client.disabled) return new Response('Connection revoked. Connect your account again.', {status:401,headers:{'WWW-Authenticate':`Bearer resource_metadata="${authOrigin()}/.well-known/oauth-protected-resource"`}});
    return handle(verifiedRequest, {userId:claims.sub,scopes:new Set(typeof claims.scope === 'string' ? claims.scope.split(' ').filter(scope=>consent.scopes.includes(scope)) : [])});
  }, {resource:`${authOrigin()}/mcp`,requiredScopes:['profile:read'],challengeScopes:['profile:read','profile:write','offline_access']})(request);
}
async function handle(request: Request, identity?:{userId:string;scopes:Set<string>}) {
  if(!request.headers.get('content-type')?.includes('application/json')) return new Response('Expected JSON', {status:415});
  const origin = request.headers.get('origin');
  if(origin && origin !== new URL(request.url).origin) return new Response('Invalid origin', {status:403});
  let body: {id?:string|number|null;jsonrpc?:string;method?:string;params?:{name?:string;arguments?:Record<string,unknown>}};
  const respond = (data:unknown,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
  try {
    const text = await request.text();
    if(text.length > 16000) return respond({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Request too large'}},413);
    body = JSON.parse(text);
    if(!body || Array.isArray(body) || body.jsonrpc !== '2.0') throw new Error();
  } catch { return respond({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON-RPC request'}}); }
  const id = body.id ?? null;
  const result = (value:unknown) => respond({jsonrpc:'2.0',id,result:value});
  if(body.method === 'server/discover') return result({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
  if(body.method === 'initialize') return result({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'wya.im',version:'1.0.0'}});
  if(body.method === 'notifications/initialized') return new Response(null,{status:202});
  if(body.method === 'tools/list') return result({tools:tools.map(tool=>({...tool,securitySchemes:[{type:'oauth2',scopes:tool.name === 'get_profile'?['profile:read']:['profile:read','profile:write']}]}))});
  if(body.method !== 'tools/call') return respond({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
  const user = identity || await getChatGPTUser();
  if(!user) return result({isError:true,content:[{type:'text',text:'Sign in to wya.im to manage your profile.'}]});
  if(identity && body.params?.name !== 'get_profile' && !identity.scopes.has('profile:write')) throw createInsufficientScopeError(['profile:write']);
  try {
    const name = body.params?.name;
    if(!tools.some(t=>t.name===name)) throw new AppError('Unknown tool.');
    const data = name === 'get_profile'
      ? {profile:await getAccount(user.userId),history:await getHistory(user.userId)}
      : {profile:await mutate(user.userId,{...body.params?.arguments,action:name})};
    return result({content:[{type:'text',text:JSON.stringify(data)}]});
  } catch(error) {
    if(!(error instanceof AppError)) console.error('MCP operation failed',error);
    return result({isError:true,content:[{type:'text',text:error instanceof AppError ? error.message : 'Could not complete the change. Try again.'}]});
  }
}
