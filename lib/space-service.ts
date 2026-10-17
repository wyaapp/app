import { limitMutation, consumeLimit, digestKey } from './abuse-limits.ts';
import { resolveLinkDestination } from './link-redirects.ts';
import { actionSchema, applyAction, AppError, normalizeHandle, MAX_SPACES, type Profile, type ProfileData, type Revision, type SpaceSummary } from './model.ts';
type Row = { id:string; user_id:string; handle:string; data:string; version:number; updated_at:string; picture_key?:string|null };
const conflict = () => new AppError('This space changed in another session. Reload it before trying again.',409);
function storageError(error:unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if(message.includes('space_limit')) throw new AppError(`You can have up to ${MAX_SPACES} spaces.`,409);
  if(message.includes('handle_taken') || message.includes('UNIQUE constraint failed: spaces.handle')) throw new AppError('This username is currently used by another space.',409);
  throw error;
}
export function createSpaceService(db:D1Database, clock:()=>number = Date.now) {
  async function profile(row:Row):Promise<Profile> {
    const aliases = await db.prepare('SELECT handle FROM space_handles WHERE space_id = ? AND handle <> ? ORDER BY created_at, handle').bind(row.id,row.handle).all<{handle:string}>();
    return {...JSON.parse(row.data) as ProfileData,id:row.id,handle:row.handle,aliases:aliases.results.map(a=>a.handle),version:row.version,updatedAt:row.updated_at,pictureUrl:row.picture_key ? `/api/pictures/${row.picture_key}` : null};
  }
  async function listSpaces(userId:string):Promise<SpaceSummary[]> {
    const result = await db.prepare("SELECT id, handle, json_extract(data, '$.name') AS name, json_extract(data, '$.theme') AS theme, version FROM spaces WHERE user_id = ? ORDER BY created_at, id").bind(userId).all<SpaceSummary>();
    return result.results;
  }
  async function getAccount(userId:string,spaceId?:string):Promise<Profile|null> {
    if(spaceId) {
      const row = await db.prepare('SELECT * FROM spaces WHERE user_id = ? AND id = ?').bind(userId,spaceId).first<Row>();
      if(!row) throw new AppError('Space not found.',404);
      return profile(row);
    }
    const rows = await db.prepare('SELECT * FROM spaces WHERE user_id = ? ORDER BY created_at, id LIMIT 2').bind(userId).all<Row>();
    if(rows.results.length > 1) throw new AppError('Choose a space first. Use list_spaces and pass its spaceId.',409);
    return rows.results[0] ? profile(rows.results[0]) : null;
  }
  async function getPublicProfile(handle:string):Promise<Profile|null> {
    const row = await db.prepare('SELECT s.* FROM spaces s JOIN space_handles h ON h.space_id = s.id WHERE h.handle = ?').bind(handle.toLowerCase()).first<Row>();
    if(!row) return null;
    const p = await profile(row);
    return {...p,links:p.links.filter(l=>l.visible)};
  }
  async function getHistory(userId:string,spaceId?:string):Promise<Revision[]> {
    const current = await getAccount(userId,spaceId);
    if(!current) return [];
    const result = await db.prepare('SELECT version, reason, created_at AS createdAt FROM space_revisions WHERE space_id = ? ORDER BY version DESC LIMIT 50').bind(current.id).all<Revision>();
    return result.results;
  }
  async function checkHandle(userId:string,value:string,spaceId?:string) {
    if(spaceId) await getAccount(userId,spaceId);
    const handle=normalizeHandle(value);
    const found=await db.prepare('SELECT id FROM spaces WHERE handle = ?').bind(handle).first<{id:string}>();
    return {handle,available:!found || found.id===spaceId};
  }
  async function mutate(userId:string,input:unknown):Promise<Profile> {
    const parsed=actionSchema.safeParse(input);
    if(!parsed.success) throw new AppError(parsed.error.issues.map(i=>i.message).join(' '));
    const action=parsed.data;
    await limitMutation(db,userId,clock());
    const now=new Date().toISOString();
    if(action.action==='create_profile') {
      const handle=normalizeHandle(action.handle);
      const id=crypto.randomUUID();
      const data:ProfileData={name:action.name,bio:action.bio??'',theme:'lilac',links:[]};
      try {
        await db.prepare('INSERT INTO spaces (id,user_id,handle,data,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)').bind(id,userId,handle,JSON.stringify(data),now,now).run();
      } catch(error) { storageError(error); }
      return {...data,id,handle,aliases:[],version:1,updatedAt:now};
    }
    const current=await getAccount(userId,action.spaceId);
    if(!current) throw new AppError('Create your first space.',404);
    if(action.expectedVersion!==current.version) throw conflict();
    const oldData:ProfileData={name:current.name,bio:current.bio,theme:current.theme,links:current.links,...(current.sections?{sections:current.sections}:{})};
    let handle=current.handle;
    let change:{data:ProfileData;reason:string};
    if(action.action==='rename_space') {
      handle=normalizeHandle(action.handle);
      if(handle===current.handle) return current;
      await consumeLimit(db,`rename-day:${await digestKey(userId)}`,10,86_400_000,clock());
      change={data:oldData,reason:`Changed username from @${current.handle} to @${handle}`};
    } else if(action.action==='restore_revision') {
      const revision=await db.prepare('SELECT data FROM space_revisions WHERE space_id = ? AND version = ?').bind(current.id,action.revision).first<{data:string}>();
      if(!revision) throw new AppError('Revision not found in this space.',404);
      change={data:JSON.parse(revision.data),reason:`Restored revision ${action.revision}`};
    } else change=applyAction(oldData,action);
    if(action.action==='upsert_link' && action.visible) {
      const proposed={...current,...change.data};
      try {
        await resolveLinkDestination(proposed,action.slug,async target=>{
          if(target===current.handle || current.aliases.includes(target)) return proposed;
          const found=await getPublicProfile(target);
          return found?.id===current.id ? proposed : found;
        },{allowUnavailable:true});
      } catch(error) {
        if(error instanceof AppError && error.status===508) throw new AppError(error.message);
        throw error;
      }
    }
    if(handle===current.handle && JSON.stringify(change.data)===JSON.stringify(oldData)) return current;
    try {
      const results=await db.batch([
        db.prepare('INSERT INTO space_revisions (id,space_id,version,data,reason,created_at) SELECT ?,id,version,data,?,? FROM spaces WHERE user_id = ? AND id = ? AND version = ?').bind(crypto.randomUUID(),change.reason,now,userId,current.id,current.version),
        db.prepare('UPDATE spaces SET data = ?, handle = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND id = ? AND version = ?').bind(JSON.stringify(change.data),handle,now,userId,current.id,current.version),
      ]);
      if(results[1].meta.changes<1) throw conflict();
    } catch(error) { storageError(error); }
    // Claims can remove another space's fallback redirect without changing its
    // content version. Always read mappings rather than predicting the aliases.
    return (await getAccount(userId,current.id))!;
  }
  return {listSpaces,getAccount,getPublicProfile,getHistory,checkHandle,mutate};
}
