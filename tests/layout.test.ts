import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actionSchema,applyAction,type ProfileData} from '../lib/model.ts';
import {applyLayout,getLinkLayout,reconcileLayout,MAX_SECTIONS} from '../lib/link-layout.ts';
const base:ProfileData={name:'Alex',bio:'',theme:'lilac',links:['code','call','project'].map(slug=>({slug,label:slug,url:'https://example.com/',platform:'website',visible:slug!=='call',icon:'rocket'}))};
const layout={ungrouped:['call'],sections:[{id:'socials',title:'Socials',slugs:['code']},{id:'projects',title:'Projects',slugs:['project']}]};
const save=(value=layout)=>actionSchema.parse({action:'set_layout',expectedVersion:1,...value});

test('legacy profiles remain ungrouped; saving layout preserves link content and includes hidden links',()=>{
  assert.deepEqual(getLinkLayout(base),{ungrouped:['code','call','project'],sections:[]});
  const next=applyAction(base,save()).data;
  assert.deepEqual(getLinkLayout(next),layout);
  assert.deepEqual(next.links.map(link=>link.slug),['call','code','project']);
  assert.equal(next.links[0].visible,false);
  assert.equal(next.links[1].icon,'rocket');
  assert.equal(next.links[1].sectionId,'socials');
  assert.equal(base.sections,undefined);
  assert.equal(base.links[0].sectionId,undefined);
});

test('layout cannot duplicate, omit, or import links, or reuse section IDs; bounds are enforced',()=>{
  for(const invalid of [
    {...layout,ungrouped:[]},
    {...layout,ungrouped:['code']},
    {...layout,ungrouped:['foreign']},
    {...layout,sections:layout.sections.map(section=>({...section,id:'duplicate'}))},
  ]) assert.throws(()=>applyAction(base,save(invalid)));
  for(const title of ['', '  ', 'x'.repeat(61)]) assert.throws(()=>save({...layout,sections:[{...layout.sections[0],title}]}));
  assert.throws(()=>save({...layout,sections:Array.from({length:MAX_SECTIONS+1},(_,i)=>({id:`s${i}`,title:'Section',slugs:[]}))}));
});

test('link edits, renames and legacy reorder retain sections; removing a section need not delete links',()=>{
  let next=applyAction(base,save()).data;
  next=applyAction(next,actionSchema.parse({action:'upsert_link',expectedVersion:2,originalSlug:'code',slug:'github',label:'GitHub',destination:'https://github.com/alex',platform:'github'})).data;
  assert.equal(next.links.find(link=>link.slug==='github')!.sectionId,'socials');
  next=applyAction(next,actionSchema.parse({action:'reorder_links',expectedVersion:3,slugs:['project','github','call']})).data;
  assert.deepEqual(next.sections,layout.sections.map(({id,title})=>({id,title})));
  assert.deepEqual(getLinkLayout(next).sections[0].slugs,['github']);
  next=applyAction(next,save({ungrouped:['github','call','project'],sections:[]})).data;
  assert.equal(next.links.length,3);assert.ok(next.links.every(link=>!link.sectionId));
});

test('draft reconciliation preserves sections and renamed positions, removes deleted links and includes new links',()=>{
  const saved=applyLayout(base,layout);
  const edited={...saved,links:[{...saved.links[1],slug:'github'},saved.links[2],{...base.links[0],slug:'new'}]};
  const draft=reconcileLayout(layout,edited,{from:'code',to:'github'});
  assert.deepEqual(draft,{ungrouped:['new'],sections:[{id:'socials',title:'Socials',slugs:['github']},{id:'projects',title:'Projects',slugs:['project']}]});
  assert.equal(applyLayout(edited,draft).links.length,3);
});
