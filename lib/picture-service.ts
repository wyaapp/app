import { AppError } from './model.ts';
import { createSpaceService } from './space-service.ts';
import { MAX_PICTURE_BYTES, PICTURE_TYPES } from './picture-limits.ts';

const conflict = () => new AppError('This space changed in another session. Reload it before saving the picture.',409);
const tooLarge = () => new AppError('Choose a picture of 5 MB or less.',413);
export async function readPicture(request:Request) {
  if(Number(request.headers.get('content-length')) > MAX_PICTURE_BYTES) throw tooLarge();
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(!PICTURE_TYPES.some(t=>t===type)) throw new AppError('Use a JPEG, PNG, or WebP picture.',415);
  if(!request.body) throw new AppError('Choose a picture first.');
  const reader = request.body.getReader();
  const chunks:Uint8Array[] = [];
  let length=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      length+=value.byteLength;
      if(length > MAX_PICTURE_BYTES) {await reader.cancel();throw tooLarge();}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  if(!length) throw new AppError('Choose a picture first.');
  const bytes=new Uint8Array(length);
  let offset=0;
  for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  // Only inspect the signature: no decoding, resizing, or re-encoding here.
  const matches = type==='image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255
    : type==='image/png' ? [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)
    : String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(!matches) throw new AppError('This file is not a supported picture.',415);
  return {bytes,type:type!};
}

export function createPictureService(db:D1Database,bucket:R2Bucket) {
  const spaces=createSpaceService(db);
  async function current(userId:string,spaceId:string,expectedVersion:number) {
    if(!spaceId || !Number.isSafeInteger(expectedVersion) || expectedVersion<1) throw new AppError('Choose a space and its current version.');
    const p=(await spaces.getAccount(userId,spaceId))!;
    if(p.version!==expectedVersion) throw conflict();
    return p;
  }
  async function discard(key:string) {
    try {
      await bucket.delete(key);
      await db.prepare('DELETE FROM picture_objects WHERE key = ?').bind(key).run();
    } catch {console.error('Picture cleanup deferred');} // The scheduled sweep retries.
  }
  async function set(userId:string,spaceId:string,expectedVersion:number,file:{bytes:Uint8Array;type:string}|null) {
    const p=await current(userId,spaceId,expectedVersion);
    if(file && (file.bytes.byteLength>MAX_PICTURE_BYTES || !file.bytes.byteLength)) throw tooLarge();
    const oldKey=p.pictureUrl?.split('/').pop();
    if(!file && !oldKey) return p;
    const key=file ? crypto.randomUUID() : null;
    const now=new Date().toISOString();
    if(key && file) {
      // Reserve before upload: crashes between R2 and D1 leave a tracked orphan.
      await db.prepare('INSERT INTO picture_objects (key,created_at) VALUES (?,?)').bind(key,now).run();
      try {await bucket.put(key,file.bytes,{httpMetadata:{contentType:file.type}});}
      catch(error) {await discard(key);throw error;}
    }
    // Do not delete a newly uploaded object on an ambiguous D1 transport error:
    // the update might have committed. The sweep checks references first.
    const result=await db.prepare('UPDATE spaces SET picture_key = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND version = ?')
      .bind(key,now,spaceId,userId,expectedVersion).run();
    if(!result.meta.changes) {if(key) await discard(key);throw conflict();}
    if(oldKey) await discard(oldKey);
    return (await spaces.getAccount(userId,spaceId))!;
  }
  async function upload(userId:string,spaceId:string,expectedVersion:number,request:Request) {
    await current(userId,spaceId,expectedVersion); // Authorize before consuming the upload.
    return set(userId,spaceId,expectedVersion,await readPicture(request));
  }
  async function copy(userId:string,spaceId:string,expectedVersion:number,sourceSpaceId:string) {
    await current(userId,spaceId,expectedVersion);
    const source=await spaces.getAccount(userId,sourceSpaceId);
    const key=source?.pictureUrl?.split('/').pop();
    if(!key) throw new AppError('That space has no picture to copy.',404);
    const object=await bucket.get(key);
    if(!object) throw new AppError('The source picture changed. Reload it and try again.',409);
    if(object.size>MAX_PICTURE_BYTES) throw tooLarge();
    return set(userId,spaceId,expectedVersion,{bytes:new Uint8Array(await object.arrayBuffer()),type:object.httpMetadata?.contentType || 'image/webp'});
  }
  async function get(key:string,request:Request) {
    const missing=()=>new Response('Picture not found.',{status:404,headers:{'Cache-Control':'no-store'}});
    if(!/^[0-9a-f-]{36}$/.test(key)) return missing();
    if(!await db.prepare('SELECT id FROM spaces WHERE picture_key = ?').bind(key).first()) return missing();
    const object=await bucket.get(key);
    if(!object) return missing();
    const headers=new Headers({'Content-Type':object.httpMetadata?.contentType || 'image/webp','Content-Length':String(object.size),'Cache-Control':'public, max-age=0, must-revalidate','ETag':object.httpEtag,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
    if(request.headers.get('if-none-match')===object.httpEtag) {headers.delete('Content-Length');return new Response(null,{status:304,headers});}
    return new Response(object.body,{headers});
  }
  async function cleanup() {
    // Grace period protects in-flight uploads. Current pictures are never selected.
    const before=new Date(Date.now()-60*60*1000).toISOString();
    const unused=await db.prepare('SELECT key FROM picture_objects WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM spaces WHERE picture_key = picture_objects.key) ORDER BY created_at LIMIT 100').bind(before).all<{key:string}>();
    for(const {key} of unused.results) await discard(key);
  }
  return {upload,copy,remove:(userId:string,spaceId:string,expectedVersion:number)=>set(userId,spaceId,expectedVersion,null),get,cleanup};
}
