import { env } from 'cloudflare:workers';
import { actionSchema, applyAction, AppError, normalizeHandle, type Profile, type ProfileData, type Revision } from './model';
type Row = { user_id: string; handle: string; data: string; version: number; updated_at: string };
function db() { if(!env.DB) throw new Error('Database is not configured.'); return env.DB; }
function profile(row: Row): Profile { return {...JSON.parse(row.data) as ProfileData,handle:row.handle,version:row.version,updatedAt:row.updated_at}; }
export async function getAccount(userId: string): Promise<Profile | null> {
  const row = await db().prepare('SELECT * FROM profiles WHERE user_id = ?').bind(userId).first<Row>();
  return row ? profile(row) : null;
}
export async function getPublicProfile(handle: string): Promise<Profile | null> {
  const row = await db().prepare('SELECT * FROM profiles WHERE handle = ?').bind(handle.toLowerCase()).first<Row>();
  if(!row) return null;
  const p = profile(row);
  return {...p,links:p.links.filter(l=>l.visible)};
}
export async function getHistory(userId: string): Promise<Revision[]> {
  const result = await db().prepare('SELECT version, reason, created_at AS createdAt FROM revisions WHERE user_id = ? ORDER BY version DESC LIMIT 50').bind(userId).all<Revision>();
  return result.results;
}
export async function mutate(userId: string, input: unknown): Promise<Profile> {
  const parsed = actionSchema.safeParse(input);
  if(!parsed.success) throw new AppError(parsed.error.issues.map(i=>i.message).join(' '));
  const action = parsed.data;
  const current = await getAccount(userId);
  const now = new Date().toISOString();
  if(action.action === 'create_profile') {
    if(current) throw new AppError('You already have a profile.',409);
    const handle = normalizeHandle(action.handle);
    const data: ProfileData = {name:action.name,bio:action.bio ?? '',theme:'lilac',links:[]};
    const result = await db().prepare('INSERT INTO profiles (user_id,handle,data,version,created_at,updated_at) VALUES (?,?,?,1,?,?) ON CONFLICT DO NOTHING').bind(userId,handle,JSON.stringify(data),now,now).run();
    if(result.meta.changes !== 1) throw new AppError('This handle is taken, or your account already has a profile.',409);
    return {...data,handle,version:1,updatedAt:now};
  }
  if(!current) throw new AppError('Create your profile first.',404);
  if(action.expectedVersion !== current.version) throw new AppError('Your profile changed in another session. Reload it before trying again.',409);
  const oldData: ProfileData = {name:current.name,bio:current.bio,theme:current.theme,links:current.links};
  let change: {data:ProfileData;reason:string};
  if(action.action === 'restore_revision') {
    const revision = await db().prepare('SELECT data FROM revisions WHERE user_id = ? AND version = ?').bind(userId,action.revision).first<{data:string}>();
    if(!revision) throw new AppError('Revision not found.',404);
    change = {data:JSON.parse(revision.data),reason:`Restored revision ${action.revision}`};
  } else change = applyAction(oldData,action);
  // A D1 batch is atomic. Both statements match the same revision, so concurrent
  // edits cannot overwrite one another or create a misleading history entry.
  const results = await db().batch([
    db().prepare('INSERT INTO revisions (id,user_id,version,data,reason,created_at) SELECT ?,user_id,version,data,?,? FROM profiles WHERE user_id = ? AND version = ?').bind(crypto.randomUUID(),change.reason,now,userId,current.version),
    db().prepare('UPDATE profiles SET data = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?').bind(JSON.stringify(change.data),now,userId,current.version),
  ]);
  if(results[1].meta.changes !== 1) throw new AppError('Your profile changed in another session. Reload it before trying again.',409);
  return {...change.data,handle:current.handle,version:current.version+1,updatedAt:now};
}
