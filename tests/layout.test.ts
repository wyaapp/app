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

test('untitled items can follow or sit between sections and retain position through edits',()=>{
  const positioned={...layout,ungroupedPosition:1};
  const next=applyAction(base,actionSchema.parse({action:'set_layout',expectedVersion:1,...positioned})).data;
  assert.deepEqual(next.links.map(link=>link.slug),['code','call','project']);
  assert.deepEqual(getLinkLayout(next),positioned);
  assert.equal(reconcileLayout(positioned,next).ungroupedPosition,1);
  // Older clients omitting the position must not pin the group back to the top.
  assert.equal(applyAction(next,save()).data.ungroupedPosition,1);
  const top=applyAction(next,actionSchema.parse({action:'set_layout',expectedVersion:2,...layout,ungroupedPosition:0})).data;
  assert.equal(top.ungroupedPosition,undefined);
  assert.deepEqual(top.links.map(link=>link.slug),['call','code','project']);
  for(const position of [-1,0.5,3,21]) assert.throws(()=>applyAction(base,actionSchema.parse({action:'set_layout',expectedVersion:1,...layout,ungroupedPosition:position})));
});

test('deleting during an unsaved reorder removes only that item and preserves the remaining draft',()=>{
  const saved=applyLayout(base,layout);
  const draft={ungrouped:['project'],sections:[{id:'projects',title:'Selected work',slugs:['call','code']},{id:'socials',title:'Socials',slugs:[]}],ungroupedPosition:2};
  const deleted=applyAction(saved,actionSchema.parse({action:'delete_link',expectedVersion:1,slug:'code'})).data;
  const remaining=reconcileLayout(draft,deleted);
  assert.deepEqual(remaining,{...draft,sections:[{...draft.sections[0],slugs:['call']},draft.sections[1]]});
  assert.deepEqual(getLinkLayout(deleted),{ungrouped:['call'],sections:[{id:'socials',title:'Socials',slugs:[]},{id:'projects',title:'Projects',slugs:['project']}]});
  // Only a later Save layout publishes pending section, title, membership and order changes.
  const published=applyAction(deleted,actionSchema.parse({action:'set_layout',expectedVersion:2,...remaining})).data;
  assert.deepEqual(getLinkLayout(published),remaining);
  assert.equal(published.links.some(link=>link.slug==='code'),false);
  assert.equal(saved.links.length,3);
});
