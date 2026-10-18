import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionSchema, applyAction, type ProfileData } from '../lib/model.ts';
import {
  getProfileLayout,
  reconcileProfileLayout,
  applyProfileLayout,
  moveItemToTab,
  moveSectionToTab,
  removeProfileTab,
  type ProfileLayout,
} from '../lib/profile-tabs.ts';

const base: ProfileData = {
  name: 'Alex',
  bio: '',
  theme: 'lilac',
  links: ['github', 'game', 'secret'].map((slug) => ({
    slug,
    label: slug,
    platform: 'website',
    url: 'https://example.com/',
    visible: slug !== 'secret',
  })),
  sections: [{ id: 'work', title: 'Work' }],
  ungroupedPosition: 1,
};
base.links[0].sectionId = 'work';
const layout: ProfileLayout = {
  defaultTabId: 'home',
  tabs: [
    {
      id: 'home',
      slug: 'home',
      title: 'Home',
      ungrouped: ['secret'],
      sections: [{ id: 'work', title: 'Work', slugs: ['github'] }],
    },
    {
      id: 'games',
      slug: 'games',
      title: 'Games',
      ungrouped: [],
      sections: [{ id: 'favorites', title: 'Games I Like', slugs: ['game'] }],
    },
  ],
};
const save = (data: ProfileData, value: unknown = layout) =>
  applyAction(
    data,
    actionSchema.parse({ action: 'set_tabs', expectedVersion: 1, ...(value as object) }),
  ).data;
const edit = (slug: string, extra: object = {}) =>
  actionSchema.parse({
    action: 'upsert_link',
    expectedVersion: 1,
    slug,
    label: slug,
    platform: 'website',
    destination: 'https://example.com/',
    ...extra,
  });

test('legacy profiles have one implicit Home tab with the same sections and order', () => {
  const result = getProfileLayout(base);
  assert.equal(result.tabs.length, 1);
  assert.equal(result.defaultTabId, 'home');
  assert.deepEqual(result.tabs[0], {
    id: 'home',
    slug: 'home',
    title: 'Home',
    ungrouped: ['game', 'secret'],
    sections: [{ id: 'work', title: 'Work', slugs: ['github'] }],
    ungroupedPosition: 1,
  });
  assert.equal(base.tabs, undefined);
  const next = save(base);
  assert.deepEqual(getProfileLayout(next), layout);
  assert.equal(next.sections, undefined);
  assert.equal(next.ungroupedPosition, undefined);
  assert.equal(next.links.find((link) => link.slug === 'secret')!.visible, false);
});

test('tabs validate limits, names, IDs, default, positions, and complete global membership', () => {
  const invalid: unknown[] = [
    { ...layout, tabs: [] },
    { ...layout, tabs: Array(6).fill(layout.tabs[0]) },
    { ...layout, defaultTabId: 'missing' },
    { ...layout, tabs: [layout.tabs[0], { ...layout.tabs[1], id: 'home' }] },
    { ...layout, tabs: [layout.tabs[0], { ...layout.tabs[1], slug: 'home' }] },
    { ...layout, tabs: [{ ...layout.tabs[0], title: ' ' }, layout.tabs[1]] },
    { ...layout, tabs: [{ ...layout.tabs[0], slug: '../evil' }, layout.tabs[1]] },
    { ...layout, tabs: [{ ...layout.tabs[0], ungroupedPosition: 2 }, layout.tabs[1]] },
    { ...layout, tabs: [{ ...layout.tabs[0], ungrouped: [] }, layout.tabs[1]] },
    { ...layout, tabs: [{ ...layout.tabs[0], ungrouped: ['secret', 'game'] }, layout.tabs[1]] },
    { ...layout, tabs: [{ ...layout.tabs[0], ungrouped: ['intruder'] }, layout.tabs[1]] },
    {
      ...layout,
      tabs: [
        layout.tabs[0],
        { ...layout.tabs[1], sections: [{ id: 'work', title: 'Duplicate', slugs: ['game'] }] },
      ],
    },
    {
      ...layout,
      tabs: [
        {
          ...layout.tabs[0],
          sections: [
            ...layout.tabs[0].sections,
            ...Array.from({ length: 19 }, (_, i) => ({ id: `s${i}`, title: 'Section', slugs: [] })),
          ],
        },
        layout.tabs[1],
      ],
    },
  ];
  for (const value of invalid) assert.throws(() => save(base, value));
});

test('item edits and renames preserve placement; new items use the default or selected tab', () => {
  const initial = save(base, { ...layout, defaultTabId: 'games' });
  const renamed = applyAction(
    initial,
    edit('favorite', { originalSlug: 'game', aliases: ['game'] }),
  ).data;
  assert.deepEqual(getProfileLayout(renamed).tabs[1].sections[0].slugs, ['favorite']);
  assert.equal(renamed.links.find((link) => link.slug === 'favorite')?.sectionId, 'favorites');
  const added = applyAction(renamed, edit('new')).data;
  assert.deepEqual(added.tabs![1].ungrouped, ['new']);
  const targeted = applyAction(added, edit('elsewhere', { tabId: 'home' })).data;
  assert.ok(targeted.tabs![0].ungrouped.includes('elsewhere'));
  const moved = applyAction(targeted, edit('favorite', { tabId: 'home' })).data;
  assert.ok(moved.tabs![0].ungrouped.includes('favorite'));
  assert.equal(moved.links.find((link) => link.slug === 'favorite')?.sectionId, undefined);
  assert.throws(() => applyAction(initial, edit('new', { tabId: 'missing' })));
  const deleted = applyAction(
    renamed,
    actionSchema.parse({ action: 'delete_link', expectedVersion: 1, slug: 'favorite' }),
  ).data;
  assert.deepEqual(deleted.tabs![1].sections[0].slugs, []);
});

test('tab-scoped layouts cannot steal items; legacy whole-layout calls cannot flatten multiple tabs', () => {
  const initial = save(base);
  const scoped = {
    action: 'set_layout',
    expectedVersion: 1,
    tabId: 'games',
    ungrouped: ['game'],
    sections: [],
  };
  const next = applyAction(initial, actionSchema.parse(scoped)).data;
  assert.deepEqual(next.tabs![0], initial.tabs![0]);
  assert.deepEqual(next.tabs![1].ungrouped, ['game']);
  assert.throws(() => applyAction(initial, actionSchema.parse({ ...scoped, tabId: undefined })));
  assert.throws(() =>
    applyAction(initial, actionSchema.parse({ ...scoped, ungrouped: ['github'] })),
  );
  assert.throws(() =>
    applyAction(
      initial,
      actionSchema.parse({
        ...scoped,
        ungrouped: [],
        sections: [{ id: 'work', title: 'Collision', slugs: ['game'] }],
      }),
    ),
  );
});

test('draft tab moves survive deletion and rename; removed tabs keep all content', () => {
  const initial = save(base);
  const moved = moveItemToTab(layout, 'github', 'games');
  const renamed = applyAction(initial, edit('code', { originalSlug: 'github' })).data;
  const draft = reconcileProfileLayout(moved, renamed, { from: 'github', to: 'code' });
  assert.ok(draft.tabs[1].ungrouped.includes('code'));
  const deleted = applyAction(
    renamed,
    actionSchema.parse({ action: 'delete_link', expectedVersion: 1, slug: 'game' }),
  ).data;
  const remaining = reconcileProfileLayout(draft, deleted);
  assert.deepEqual(remaining.tabs[1].sections[0].slugs, []);
  assert.ok(remaining.tabs[1].ungrouped.includes('code'));
  const combined = removeProfileTab({ ...remaining, defaultTabId: 'games' }, 'games', 'home');
  assert.equal(combined.defaultTabId, 'home');
  assert.equal(combined.tabs.length, 1);
  assert.deepEqual(
    combined.tabs[0].sections.map((section) => section.id),
    ['work', 'favorites'],
  );
  assert.deepEqual(
    applyProfileLayout(deleted, combined).links.map((link) => link.slug),
    ['secret', 'code'],
  );
  assert.deepEqual(removeProfileTab(combined, 'home', 'home'), combined);
  assert.equal(initial.links.length, 3);
});

test('moving an entire section keeps its items and adjusts the source ungrouped position', () => {
  const withPosition = {
    ...layout,
    tabs: [{ ...layout.tabs[0], ungroupedPosition: 1 }, layout.tabs[1]],
  };
  const moved = moveSectionToTab(withPosition, 'work', 'games');
  assert.equal(moved.tabs[0].ungroupedPosition, undefined);
  assert.deepEqual(
    moved.tabs[1].sections.map((section) => section.id),
    ['favorites', 'work'],
  );
  assert.deepEqual(moved.tabs[1].sections[1].slugs, ['github']);
  assert.equal(withPosition.tabs[0].sections.length, 1);
  assert.deepEqual(moveSectionToTab(layout, 'missing', 'games'), layout);
});

test('reorder_links changes order within tabs without changing their membership', () => {
  const initial = save(base, {
    ...layout,
    tabs: [{ ...layout.tabs[0], ungrouped: ['github', 'secret'], sections: [] }, layout.tabs[1]],
  });
  const result = applyAction(
    initial,
    actionSchema.parse({
      action: 'reorder_links',
      expectedVersion: 1,
      slugs: ['game', 'secret', 'github'],
    }),
  ).data;
  assert.deepEqual(result.tabs![0].ungrouped, ['secret', 'github']);
  assert.deepEqual(result.tabs![1].sections[0].slugs, ['game']);
});
