import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGameCatalog} from '../lib/game-catalog.ts';
import {AppError} from '../lib/model.ts';
const entry={id:123,name:'Hollow Knight',slug:'hollow-knight',cover:{image_id:'co123'},first_release_date:1487894400,platforms:[{name:'PC'}]};
const query={type:'game',query:'Hollow Knight'};
const credentials={clientId:'test-client',clientSecret:'test-secret'};
function fixture(responses:Response[]) {
  const calls:{url:string;init?:RequestInit}[]=[];
  const fetcher=(async(url,init)=>{calls.push({url:String(url),init});const response=responses.shift();if(!response)throw Error('Unexpected request');return response;}) as typeof fetch;
  return {calls,fetcher};
}
const token=()=>Response.json({access_token:'test-token',expires_in:3600});

test('catalog searches fixed endpoints, normalizes results, caches searches and reuses server-only tokens',async()=>{
  const f=fixture([token(),Response.json([entry]),Response.json([])]);let limited=0;
  const catalog=createGameCatalog({...credentials,...f,beforeRequest:async()=>{limited++;}});
  const first=await catalog.search(query);
  assert.equal(first[0].coverUrl,'https://images.igdb.com/igdb/image/upload/t_cover_big/co123.jpg');assert.equal(first[0].year,2017);assert.deepEqual(first[0].source,{provider:'igdb',id:123,slug:'hollow-knight'});
  first[0].title='mutated';assert.equal((await catalog.search({...query,query:'hollow knight'}))[0].title,'Hollow Knight');
  await catalog.search({...query,query:'Stardew'});
  assert.equal(f.calls.length,3);assert.equal(limited,2);
  assert.equal(f.calls[0].url,'https://id.twitch.tv/oauth2/token');assert.equal(f.calls[1].url,'https://api.igdb.com/v4/games');
  assert.ok(!JSON.stringify(first).includes('test-secret'));assert.ok(!f.calls[0].url.includes('test-secret'));
});

test('catalog rejects invalid input before network and does not cache errors',async()=>{
  const f=fixture([token(),new Response('',{status:429}),Response.json([])]);
  const catalog=createGameCatalog({...credentials,...f});
  await assert.rejects(catalog.search({...query,query:'a'}),{status:400});await assert.rejects(catalog.search({...query,type:'anime'}),{status:400});assert.equal(f.calls.length,0);
  await assert.rejects(catalog.search(query),{status:429});assert.deepEqual(await catalog.search(query),[]);
  await assert.rejects(createGameCatalog({fetcher:f.fetcher}).search(query),{status:503});assert.equal(f.calls.length,3);
});

test('expired tokens refresh once, query syntax is escaped, and invalid upstream content stays an unavailable response',async()=>{
  const f=fixture([token(),new Response('',{status:401}),token(),Response.json([entry]),Response.json([{...entry,cover:{image_id:'../../evil'}}])]);
  const catalog=createGameCatalog({...credentials,...f});
  await catalog.search({...query,query:'x"; limit 500; search "\\test'});
  assert.match(String(f.calls[1].init?.body),/search "x\\"; limit 500; search \\"\\\\test"/);
  assert.equal(f.calls.length,4);
  await assert.rejects(catalog.search(query),{status:503});
});

test('provider quota is checked before each uncached upstream request and token values never reach errors',async()=>{
  const f=fixture([token()]);
  const catalog=createGameCatalog({...credentials,...f,beforeRequest:async()=>{throw new AppError('Too many requests.',429);}});
  await assert.rejects(catalog.search(query),{status:429});assert.equal(f.calls.length,1);
  const broken=createGameCatalog({...credentials,fetcher:(async()=>{throw Error('test-secret');}) as typeof fetch});
  await assert.rejects(broken.search(query),(error:unknown)=>error instanceof AppError&&error.status===503&&!error.message.includes('test-secret'));
});
