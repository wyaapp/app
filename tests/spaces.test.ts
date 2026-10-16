import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createSpaceService } from '../lib/space-service.ts';
import { AppError, type ProfileData } from '../lib/model.ts';

const data:ProfileData={name:'Original',bio:'Existing profile',theme:'lime',links:[{slug:'code',label:'Code',url:'https://example.com/',platform:'github',icon:'rocket',visible:true}]};
function fixture(legacy=false) {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(readFileSync('drizzle/0000_dapper_morlocks.sql','utf8'));
  if(legacy) {
    sqlite.prepare('INSERT INTO profiles VALUES (?,?,?,?,?,?)').run('alice','original',JSON.stringify(data),2,'2026-01-01','2026-01-02');
    sqlite.prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?)').run('rev1','alice',1,JSON.stringify({...data,bio:'Before'}),'Updated profile','2026-01-02');
  }
  sqlite.exec(readFileSync('drizzle/0002_spaces.sql','utf8'));
  sqlite.exec(readFileSync('drizzle/0004_profile_pictures.sql','utf8'));
  function prepare(sql:string) {
    let values:SQLInputValue[]=[];
    const statement={
      bind(...args:SQLInputValue[]){values=args;return statement;},
      async first(){return sqlite.prepare(sql).get(...values) ?? null;},
      async all(){return {results:sqlite.prepare(sql).all(...values)};},
      async run(){return statement.execute();},
      execute(){const result=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(result.changes)},results:[]};},
    };
    return statement;
  }
  const db={prepare,async batch(statements:ReturnType<typeof prepare>[]) {
    sqlite.exec('BEGIN');
    try {const results=statements.map(s=>s.execute());sqlite.exec('COMMIT');return results;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }} as unknown as D1Database;
  return {sqlite,service:createSpaceService(db)};
}
const create=(handle:string)=>({action:'create_profile',handle,name:handle});
const status=(expected:number)=>(error:unknown)=>error instanceof AppError && error.status===expected;

test('migration preserves profiles, link icons, versions and history, including old Worker writes during rollout',async()=>{
  const {sqlite,service}=fixture(true);
  let profile=(await service.getAccount('alice'))!;
  assert.equal(profile.id,'legacy:alice');assert.equal(profile.version,2);assert.deepEqual(profile.links,data.links);
  assert.equal((await service.getHistory('alice'))[0].reason,'Updated profile');
  sqlite.exec('BEGIN');
  sqlite.prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?)').run('rev2','alice',2,JSON.stringify(data),'Old Worker edit','2026-01-03');
  sqlite.prepare('UPDATE profiles SET data=?, version=3 WHERE user_id=?').run(JSON.stringify({...data,bio:'During deployment'}),'alice');
  sqlite.exec('COMMIT');
  profile=(await service.getAccount('alice'))!;
  assert.equal(profile.bio,'During deployment');assert.equal(profile.version,3);assert.equal((await service.getHistory('alice')).length,2);
  sqlite.prepare('INSERT INTO profiles VALUES (?,?,?,?,?,?)').run('bob','old-worker-signup',JSON.stringify(data),1,'2026-01-03','2026-01-03');
  assert.equal((await service.getAccount('bob'))!.handle,'old-worker-signup');
  await service.mutate('alice',{action:'update_profile',expectedVersion:3,bio:'New Worker edit'});
  assert.throws(()=>sqlite.prepare('UPDATE profiles SET version=4 WHERE user_id=?').run('alice'),/space_changed/);
  assert.equal((await service.getAccount('alice'))!.bio,'New Worker edit');
});

test('five-space limit holds under competing requests and aliases do not consume slots',async()=>{
  const {service}=fixture();
  const first=await service.mutate('alice',create('one'));
  await service.mutate('alice',{action:'rename_space',expectedVersion:1,handle:'one-renamed'});
  for(const handle of ['two','three','four']) await service.mutate('alice',create(handle));
  const results=await Promise.allSettled(['five','six'].map(handle=>service.mutate('alice',create(handle))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected' && status(409)(r.reason)).length,1);
  assert.equal((await service.listSpaces('alice')).length,5);
  assert.equal((await service.getAccount('alice',first.id))!.aliases[0],'one');
  await service.mutate('bob',create('bob'));
  assert.equal((await service.listSpaces('bob')).length,1);
});

test('accounts and spaces isolate reads, edits and history; ambiguous requests fail closed',async()=>{
  const {service}=fixture();
  const a=await service.mutate('alice',create('personal'));
  const b=await service.mutate('alice',create('work'));
  await assert.rejects(service.getAccount('alice'),status(409));
  await assert.rejects(service.mutate('alice',{action:'update_profile',expectedVersion:1,bio:'Ambiguous'}),status(409));
  await assert.rejects(service.getAccount('bob',a.id),status(404));
  await assert.rejects(service.getHistory('bob',a.id),status(404));
  await assert.rejects(service.checkHandle('bob','available',a.id),status(404));
  await assert.rejects(service.mutate('bob',{action:'update_profile',spaceId:a.id,expectedVersion:1,bio:'Attack'}),status(404));
  await service.mutate('alice',{action:'update_profile',spaceId:a.id,expectedVersion:1,bio:'Personal bio'});
  assert.equal((await service.getAccount('alice',b.id))!.bio,'');
  assert.equal((await service.getHistory('alice',b.id)).length,0);
  await assert.rejects(service.mutate('alice',{action:'restore_revision',spaceId:b.id,expectedVersion:1,revision:1}),status(404));
});

test('renames reserve every former address, allow rename-back, and resolve directly to the latest space',async()=>{
  const {service}=fixture(true);
  let p=await service.mutate('alice',{action:'rename_space',expectedVersion:2,handle:' @Alex.New '});
  assert.equal(p.handle,'alex.new');assert.deepEqual(p.aliases,['original']);
  for(const handle of ['original','alex.new']) assert.equal((await service.getPublicProfile(handle))!.id,p.id);
  await assert.rejects(service.mutate('bob',create('original')),status(409));
  const other=await service.mutate('alice',create('other'));
  await assert.rejects(service.mutate('alice',{action:'rename_space',spaceId:other.id,expectedVersion:1,handle:'original'}),status(409));
  assert.equal((await service.getHistory('alice',other.id)).length,0);
  assert.equal((await service.checkHandle('alice','original',p.id)).available,true);
  assert.equal((await service.checkHandle('alice','original',other.id)).available,false);
  p=await service.mutate('alice',{action:'rename_space',spaceId:p.id,expectedVersion:p.version,handle:'third'});
  assert.equal((await service.getPublicProfile('original'))!.handle,'third');
  p=await service.mutate('alice',{action:'rename_space',spaceId:p.id,expectedVersion:p.version,handle:'original'});
  assert.equal((await service.getPublicProfile('third'))!.handle,'original');
  p=await service.mutate('alice',{action:'restore_revision',spaceId:p.id,expectedVersion:p.version,revision:1});
  assert.equal(p.bio,'Before');assert.equal(p.handle,'original');
  assert.deepEqual(new Set(p.aliases),new Set(['alex.new','third']));
  assert.equal(p.links[0].icon,'rocket');
});

test('concurrent renames and competing claims are atomic with no stray aliases or history',async()=>{
  const {service}=fixture();
  const a=await service.mutate('alice',create('start'));
  const changes=await Promise.allSettled(['first','second'].map(handle=>service.mutate('alice',{action:'rename_space',spaceId:a.id,expectedVersion:1,handle})));
  assert.equal(changes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(changes.filter(r=>r.status==='rejected' && status(409)(r.reason)).length,1);
  const current=(await service.getAccount('alice',a.id))!;
  const loser=current.handle==='first'?'second':'first';
  assert.equal(await service.getPublicProfile(loser),null);
  assert.equal((await service.getHistory('alice',a.id)).length,1);
  const b=await service.mutate('bob',create('bob'));
  const claims=await Promise.allSettled([[a.id,'alice',current.version],[b.id,'bob',1]].map(([spaceId,userId,expectedVersion])=>service.mutate(String(userId),{action:'rename_space',spaceId,expectedVersion,handle:'shared'})));
  assert.equal(claims.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(claims.filter(r=>r.status==='rejected' && status(409)(r.reason)).length,1);
  assert.equal((await service.getHistory('alice',a.id)).length+(await service.getHistory('bob',b.id)).length,2);
});
