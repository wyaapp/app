import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionSchema, applyAction, normalizeHandle, normalizeDestination, type ProfileData } from '../lib/model.ts';
const base: ProfileData = {name:'Alex',bio:'Hello',theme:'lilac',links:[]};
test('handles accept social username characters, normalize case, and reject reserved routes',()=>{
  assert.equal(normalizeHandle('@Alex.Castro_1'),'alex.castro_1');
  for(const value of ['api','Dashboard','../alex','.alex','alex.','..','two names','_alex','a'.repeat(40)]) assert.throws(()=>normalizeHandle(value));
});
test('social usernames become URLs; unsafe schemes and redirect loops are rejected',()=>{
  assert.equal(normalizeDestination('github','@alex-castro'),'https://github.com/alex-castro');
  assert.equal(normalizeDestination('instagram','alex.castro'),'https://www.instagram.com/alex.castro');
  assert.equal(normalizeDestination('discord','https://discord.gg/hello'),'https://discord.gg/hello');
  for(const value of ['javascript:alert(1)','data:text/html,x','https://user:pass@example.com','https://wya.im/a/b','not a URL']) assert.throws(()=>normalizeDestination('custom',value));
  assert.throws(()=>normalizeDestination('github','name/path'));
});
test('updates preserve omitted fields and do not mutate the existing snapshot',()=>{
  const action = actionSchema.parse({action:'update_profile',expectedVersion:1,bio:'Updated'});
  const next=applyAction(base,action).data;
  assert.equal(next.name,'Alex');assert.equal(next.bio,'Updated');assert.equal(base.bio,'Hello');
});
test('add, replace, hide, reorder, and delete have deterministic behavior',()=>{
  const add = (slug:string) => actionSchema.parse({action:'upsert_link',expectedVersion:1,slug,label:slug,destination:'https://example.com',platform:'website'});
  for(const invalid of ['.','..','.link','link.','a/b','a%2Eb']) assert.throws(()=>add(invalid));
  let p = applyAction(base,add(' My.Portfolio ')).data;
  p=applyAction(p,add('two')).data;
  const hidden=actionSchema.parse({...add(' My.Portfolio '),visible:false,destination:'https://example.org'});
  p=applyAction(p,hidden).data;
  assert.equal(p.links.length,2);assert.equal(p.links[0].visible,false);assert.equal(p.links[0].url,'https://example.org/');
  p=applyAction(p,actionSchema.parse({action:'reorder_links',expectedVersion:3,slugs:['two','my.portfolio']})).data;
  assert.deepEqual(p.links.map(l=>l.slug),['two','my.portfolio']);
  assert.throws(()=>applyAction(p,actionSchema.parse({action:'reorder_links',expectedVersion:3,slugs:['my.portfolio','my.portfolio']})));
  p=applyAction(p,actionSchema.parse({action:'delete_link',expectedVersion:4,slug:'my.portfolio'})).data;
  assert.equal(p.links.length,1);assert.equal(base.links.length,0);
});
test('actions reject owner overrides, missing concurrency versions, and unsupported fields',()=>{
  assert.equal(actionSchema.safeParse({action:'update_profile',name:'X'}).success,false);
  assert.equal(actionSchema.safeParse({action:'update_profile',expectedVersion:1,userId:'someone-else'}).success,false);
  assert.equal(actionSchema.safeParse({action:'create_profile',handle:'alex',name:'Alex',verified:true}).success,false);
});
