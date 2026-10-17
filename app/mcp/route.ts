import { readText } from '@/lib/request-body';
import { getChatGPTUser } from '../chatgpt-auth';
import { getAccount, getHistory, listSpaces, mutate } from '@/lib/service';
import { getAuth, isStandalone, authOrigin } from '@/lib/auth/server';
import { requireMcpAuth } from '@better-auth/mcp';
import { createInsufficientScopeError } from 'better-auth/oauth2';
import { AppError, spaceSelectorSchema, pictureActionSchema } from '@/lib/model';
import { pictures } from '@/lib/pictures';
import { platforms, iconIds } from '@/lib/link-options';
import { themeIds } from '@/lib/profile-themes';
export const dynamic = 'force-dynamic';
const string = {type:'string'};
const bio = {type:'string',maxLength:280,description:'Plain-text bio. Clickable mentions: @handle for Wya; github:username, instagram:username, linkedin:username, youtube:username, tiktok:username, x:username, bluesky:handle.bsky.social, telegram:username, twitch:username. Full HTTP(S) URLs also become links. No HTML or Markdown required. Mentions do not notify or verify the mentioned account.'};
const spaceId = {type:'string',description:'Stable space ID from list_spaces or get_profile. Required whenever the account has multiple spaces. Ask which space if unclear; never guess.'};
const readTools = new Set(['get_profile','list_spaces']);
const expectedVersion = {type:'integer',minimum:1,description:'The version returned by get_profile. Read the current profile before making a change.'};
const definition = (name: string, description: string, properties: Record<string,unknown>, required: string[], destructive = false) => ({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:destructive,idempotentHint:false,openWorldHint:false}});
const tools = [
  definition('remove_profile_picture','Remove the picture from the selected space and show initials instead. Pictures have no history and cannot be restored. Requires an explicit space ID.',{spaceId,expectedVersion},['spaceId','expectedVersion'],true),
  definition('copy_profile_picture','Copy the current picture from one of the signed-in account’s spaces to another. Both spaces must belong to this account. Replaces the destination picture without photo history. To upload a new picture, direct the user to pictureEditorUrl returned by get_profile; do not claim to transfer conversation attachments.',{spaceId,sourceSpaceId:{type:'string',description:'Stable ID of the owned space to copy the picture from.'},expectedVersion},['spaceId','sourceSpaceId','expectedVersion'],true),
  {name:'get_profile',description:'Read the authenticated user’s wya.im profile, links, current version, and recent revisions. Pass spaceId from list_spaces. With multiple spaces, ask the user which space if unclear. Never accepts an owner ID; always uses the signed-in account.',inputSchema:{type:'object',properties:{spaceId},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  {name:'list_spaces',description:'List the signed-in account’s spaces (up to five), including stable IDs, usernames, names, themes, and versions. Use this to choose a space before reading or editing. Ask the user when the target is ambiguous.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  definition('rename_space','Change a space’s username. The new username must not be currently used by another space. Previous usernames are available immediately. Only the immediately previous username redirects profiles and short links here, until someone claims it or this space renames again. Mention this consequence when proposing a rename. This does not change its stable ID or count as another space. Use the exact new username the user requested.',{spaceId,expectedVersion,handle:string},['expectedVersion','handle']),
  definition('create_profile','Create a new independent space for the signed-in user, up to five per account. Ask for the desired username and display name. Existing profiles become the first space. Use rename_space to change an existing username.',{handle:string,name:string,bio},['handle','name']),
  definition('update_profile','Change the signed-in user’s display name, bio, or color theme. Omitted fields are preserved.',{spaceId,expectedVersion,name:string,bio,theme:{type:'string',enum:themeIds}},['expectedVersion']),
  definition('upsert_link','Add or update a named redirect in the signed-in user’s directory. Instagram and GitHub accept a username or URL; other platforms require a full URL. Wya homepage, profile and short-link URLs are allowed; internal redirect cycles and chains longer than 10 links are rejected. Hidden links are also disabled as redirects. The label is its display name; slug is the short URL segment. To change a slug, pass originalSlug to identify the existing link and slug for its new URL. Renaming preserves its position but retires the old URL without a redirect; explain this consequence. Omitting originalSlug keeps existing upsert behavior. Choose an icon independently of the platform; omit icon to preserve it, or set null to use the platform default.',{spaceId,expectedVersion,slug:string,originalSlug:{type:'string',description:'Existing slug of the link being edited. Required when changing its slug; prevents creating a duplicate or replacing another link.'},label:string,destination:string,platform:{type:'string',enum:platforms},icon:{type:['string','null'],enum:[...iconIds,null],description:'Optional library icon. Null resets to the platform default; omitted preserves the current icon.'},visible:{type:'boolean',default:true}},['expectedVersion','slug','label','destination','platform']),
  definition('delete_link','Remove a named link from the signed-in user’s profile and disable its redirect. The previous state remains in history.',{spaceId,expectedVersion,slug:string},['expectedVersion','slug'],true),
  definition('reorder_links','Reorder all the signed-in user’s links. Include every slug exactly once, including hidden links.',{spaceId,expectedVersion,slugs:{type:'array',items:string}},['expectedVersion','slugs']),
  definition('restore_revision','Restore the signed-in user’s profile and links to a prior revision from get_profile. Replaces current name, bio, theme, and links, while preserving the handle and current picture. Pictures are not included in revision history. The current state is also saved to history.',{spaceId,expectedVersion,revision:{type:'integer',minimum:1}},['expectedVersion','revision'],true),
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
    const text = await readText(request);
    body = JSON.parse(text);
    if(!body || Array.isArray(body) || body.jsonrpc !== '2.0') throw new Error();
  } catch(error) {
    if(error instanceof AppError) return respond({jsonrpc:'2.0',id:null,error:{code:-32600,message:error.message}},error.status);
    return respond({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON-RPC request'}});
  }
  const id = body.id ?? null;
  const result = (value:unknown) => respond({jsonrpc:'2.0',id,result:value});
  if(body.method === 'server/discover') return result({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
  if(body.method === 'initialize') return result({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'wya.im',version:'1.0.0'}});
  if(body.method === 'notifications/initialized') return new Response(null,{status:202});
  if(body.method === 'tools/list') return result({tools:tools.map(tool=>({...tool,securitySchemes:[{type:'oauth2',scopes:readTools.has(tool.name)?['profile:read']:['profile:read','profile:write']}]}))});
  if(body.method !== 'tools/call') return respond({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
  const user = identity || await getChatGPTUser();
  if(!user) return result({isError:true,content:[{type:'text',text:'Sign in to wya.im to manage your profile.'}]});
  if(identity && !readTools.has(body.params?.name ?? '') && !identity.scopes.has('profile:write')) throw createInsufficientScopeError(['profile:write']);
  try {
    const name = body.params?.name;
    if(!tools.some(t=>t.name===name)) throw new AppError('Unknown tool.');
    let data:unknown;
    if(name === 'list_spaces') {
      if(Object.keys(body.params?.arguments ?? {}).length) throw new AppError('list_spaces does not accept arguments.');
      data={spaces:await listSpaces(user.userId),limit:5};
    } else if(name === 'get_profile') {
      const parsed=spaceSelectorSchema.safeParse(body.params?.arguments ?? {});
      if(!parsed.success) throw new AppError('Pass only the spaceId from list_spaces.');
      const profile=await getAccount(user.userId,parsed.data.spaceId);
      data={profile,history:profile?await getHistory(user.userId,profile.id):[],pictureEditorUrl:profile?`${authOrigin()}/dashboard?space=${encodeURIComponent(profile.id)}&tab=profile`:null};
    } else if(name==='remove_profile_picture' || name==='copy_profile_picture') {
      const parsed=pictureActionSchema.safeParse({...body.params?.arguments,action:name});
      if(!parsed.success) throw new AppError('Pass the space ID, current expectedVersion, and sourceSpaceId when copying a picture.');
      const action=parsed.data;
      data={profile:action.action==='remove_profile_picture' ? await pictures().remove(user.userId,action.spaceId,action.expectedVersion) : await pictures().copy(user.userId,action.spaceId,action.expectedVersion,action.sourceSpaceId)};
    } else data={profile:await mutate(user.userId,{...body.params?.arguments,action:name})};
    return result({content:[{type:'text',text:JSON.stringify(data)}]});
  } catch(error) {
    if(!(error instanceof AppError)) console.error('MCP operation failed',error);
    return result({isError:true,content:[{type:'text',text:error instanceof AppError ? error.message : 'Could not complete the change. Try again.'}]});
  }
}
