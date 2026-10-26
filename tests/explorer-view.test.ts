import test from 'node:test';
import assert from 'node:assert/strict';
import { explorerView, type ExplorerSort } from '../lib/explorer-view.ts';

const items = [
  { kind: 'file' as const, name: 'Note 10.txt', key: 'file:10' },
  { kind: 'page' as const, name: 'Socials.md', key: 'page:socials' },
  { kind: 'folder' as const, name: 'Projects', key: 'folder:projects' },
  { kind: 'file' as const, name: 'Note 2.txt', key: 'file:2' },
  { kind: 'app' as const, name: 'Paint', key: 'app:paint' },
  { kind: 'folder' as const, name: 'Archives', key: 'folder:archives' },
];

test('folders stay first in every sort and filenames use natural numeric ordering', () => {
  for (const sort of ['name-asc', 'name-desc', 'type'] satisfies ExplorerSort[]) {
    const result = explorerView(items, '', sort, 'en');
    assert.ok(result.slice(0, 2).every((item) => item.kind === 'folder'));
    const files = result.filter((item) => item.kind === 'file').map((item) => item.name);
    assert.deepEqual(
      files,
      sort === 'name-desc' ? ['Note 10.txt', 'Note 2.txt'] : ['Note 2.txt', 'Note 10.txt'],
    );
  }
});

test('search ignores case, surrounding spaces and accents across item kinds', () => {
  const entries = [
    { kind: 'folder' as const, name: 'Anotações' },
    { kind: 'file' as const, name: 'ANOTACOES.md' },
    { kind: 'page' as const, name: 'Anotações antigas.md' },
    { kind: 'app' as const, name: 'Paint' },
  ];
  assert.equal(explorerView(entries, ' anotaCOES ', 'name-asc', 'pt-BR').length, 3);
  assert.deepEqual(explorerView(entries, 'missing', 'name-asc', 'pt-BR'), []);
  assert.equal(explorerView(entries, '  ', 'name-asc', 'pt-BR').length, 4);
});

test('type sorting groups extensions and preserves original items for selection and commands', () => {
  const source = [
    { kind: 'file' as const, name: 'a.txt', key: 'txt' },
    { kind: 'file' as const, name: 'b.md', key: 'md' },
    { kind: 'app' as const, name: 'Paint', key: 'app' },
  ];
  const order = source.slice();
  const result = explorerView(source, '', 'type', 'en');
  assert.deepEqual(
    result.map((item) => item.key),
    ['app', 'md', 'txt'],
  );
  assert.deepEqual(source, order);
  assert.equal(result[0], source[2]);
});
