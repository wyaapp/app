import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialsKey } from '../lib/initials-avatar.ts';

test('initials use the first two words with stable normalization and case', () => {
  assert.equal(initialsKey('Alex Castro', 'on'), 'initials-v1:AC');
  assert.equal(initialsKey('  alex  castro junior  ', 'other'), 'initials-v1:AC');
  assert.equal(initialsKey('Alex', 'on'), 'initials-v1:A');
  assert.equal(initialsKey('Érica Çosta', 'ec'), 'initials-v1:ÉÇ');
  assert.equal(initialsKey('E\u0301rica C\u0327osta', 'ec'), 'initials-v1:ÉÇ');
  assert.equal(initialsKey('Нина Иванова', 'ni'), 'initials-v1:НИ');
  assert.equal(initialsKey('ßeta Bob', 'bb'), 'initials-v1:SB');
});

test('unsupported names fall back to the handle without dynamic font or emoji fetches', () => {
  for (const name of ['李 王', '🌎 Alex', '  ', '<script>', '\u0000Alice', 'أحمد محمد'])
    assert.equal(initialsKey(name, 'on'), 'initials-v1:ON');
  assert.equal(initialsKey('李', 'design.preview'), 'initials-v1:DE');
  assert.equal(initialsKey('', ''), 'initials-v1:?');
  assert.equal(initialsKey('A' + '\u0301'.repeat(100), 'on'), 'initials-v1:ON');
});
