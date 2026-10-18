import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDropAt, dropLayoutItem, type LayoutGroupRect } from '../lib/layout-drag.ts';
const layout = {
  ungrouped: ['mail'],
  sections: [
    { id: 'socials', title: 'Socials', slugs: ['github', 'linkedin'] },
    { id: 'projects', title: 'Projects', slugs: ['work'] },
    { id: 'empty', title: 'Empty', slugs: [] },
  ],
};
const groups: LayoutGroupRect[] = [
  { id: '', top: 0, bottom: 90, rows: [{ id: 'mail', top: 0, bottom: 90 }] },
  {
    id: 'socials',
    top: 120,
    bottom: 390,
    rows: [
      { id: 'github', top: 160, bottom: 260 },
      { id: 'linkedin', top: 280, bottom: 390 },
    ],
  },
  { id: 'projects', top: 420, bottom: 580, rows: [{ id: 'work', top: 460, bottom: 580 }] },
  { id: 'empty', top: 610, bottom: 710, rows: [] },
];
test('section drops work in whitespace, above the first section, and after the last; contents stay together', () => {
  const source = { kind: 'section' as const, id: 'projects' };
  const before = layoutDropAt(source, 110, groups)!;
  assert.deepEqual(before, { kind: 'section', beforeId: 'socials' });
  const moved = dropLayoutItem(layout, source, before);
  assert.deepEqual(
    moved.sections.map((s) => s.id),
    ['projects', 'socials', 'empty'],
  );
  assert.deepEqual(moved.sections[0].slugs, ['work']);
  const end = layoutDropAt(source, 720, groups)!;
  assert.deepEqual(
    dropLayoutItem(layout, source, end).sections.map((s) => s.id),
    ['socials', 'empty', 'projects'],
  );
  assert.deepEqual(layout.ungrouped, ['mail']);
  assert.deepEqual(
    layout.sections.map((s) => s.id),
    ['socials', 'projects', 'empty'],
  );
});
test('link insertion uses row midpoints, excludes the dragged row, and accepts empty and ungrouped areas', () => {
  const source = { kind: 'link' as const, id: 'github' };
  assert.deepEqual(layoutDropAt(source, 280, groups), {
    kind: 'link',
    groupId: 'socials',
    beforeId: 'linkedin',
  });
  const toEmpty = layoutDropAt(source, 650, groups)!;
  const moved = dropLayoutItem(layout, source, toEmpty);
  assert.deepEqual(moved.sections[2].slugs, ['github']);
  assert.deepEqual(moved.sections[0].slugs, ['linkedin']);
  assert.deepEqual(dropLayoutItem(layout, source, layoutDropAt(source, 20, groups)!).ungrouped, [
    'github',
    'mail',
  ]);
  assert.deepEqual(layoutDropAt(source, 405, groups), {
    kind: 'link',
    groupId: 'socials',
    beforeId: null,
  });
});
test('unchanged, missing and incompatible drop targets cannot lose items or create a dirty draft', () => {
  assert.equal(
    dropLayoutItem(
      layout,
      { kind: 'section', id: 'socials' },
      { kind: 'section', beforeId: 'projects' },
    ),
    layout,
  );
  assert.equal(
    dropLayoutItem(layout, { kind: 'section', id: 'missing' }, { kind: 'section', beforeId: null }),
    layout,
  );
  assert.equal(
    dropLayoutItem(
      layout,
      { kind: 'link', id: 'github' },
      { kind: 'link', groupId: 'missing', beforeId: null },
    ),
    layout,
  );
  assert.equal(
    dropLayoutItem(
      layout,
      { kind: 'link', id: 'github' },
      { kind: 'link', groupId: 'projects', beforeId: 'missing' },
    ),
    layout,
  );
  assert.equal(
    dropLayoutItem(layout, { kind: 'link', id: 'github' }, { kind: 'section', beforeId: null }),
    layout,
  );
  assert.equal(layoutDropAt({ kind: 'section', id: 'socials' }, 200, [groups[1]]), null);
});

test('a section can move above every ungrouped widget, and the ungrouped block can move back', () => {
  const source = { kind: 'section' as const, id: 'projects' };
  const first = layoutDropAt(source, 0, groups)!;
  assert.deepEqual(first, { kind: 'section', beforeId: '' });
  const moved = dropLayoutItem(layout, source, first);
  assert.equal(moved.ungroupedPosition, 1);
  assert.deepEqual(
    moved.sections.map((section) => section.id),
    ['projects', 'socials', 'empty'],
  );
  assert.deepEqual(moved.ungrouped, ['mail']);
  const bottom = dropLayoutItem(
    moved,
    { kind: 'section', id: '' },
    { kind: 'section', beforeId: null },
  );
  assert.equal(bottom.ungroupedPosition, 3);
  const back = dropLayoutItem(
    bottom,
    { kind: 'section', id: '' },
    { kind: 'section', beforeId: 'projects' },
  );
  assert.equal(back.ungroupedPosition, undefined);
});
