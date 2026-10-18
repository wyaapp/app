import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EntryAutosave } from '../lib/entry-autosave.ts';
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

test('autosave debounces edits and does not write untouched or reverted values', async () => {
  const writes: unknown[] = [];
  const queue = new EntryAutosave(
    { title: 'original' },
    {
      save: async (data) => {
        writes.push(data);
        return true;
      },
      valid: () => true,
      status: () => {},
      delay: 5,
    },
  );
  queue.update({ title: 'original' });
  await pause();
  assert.equal(writes.length, 0);
  queue.update({ title: 'one' });
  queue.update({ title: 'two' });
  await pause();
  assert.deepEqual(writes, [{ title: 'two' }]);
  assert.equal(queue.dirty, false);
  queue.update({ title: 'draft' });
  queue.update({ title: 'two' });
  await pause();
  assert.equal(writes.length, 1);
  queue.cancel();
});

test('autosave retains failed edits without retry loops and supports explicit retry', async () => {
  let calls = 0,
    success = false;
  const statuses: string[] = [];
  const queue = new EntryAutosave(
    { title: 'original' },
    {
      save: async () => {
        calls++;
        return success;
      },
      valid: () => true,
      status: (s) => statuses.push(s),
      delay: 5,
    },
  );
  queue.update({ title: 'draft' });
  await pause();
  queue.update({ title: 'draft' });
  await pause();
  assert.equal(calls, 1);
  assert.equal(queue.dirty, true);
  assert.equal(statuses.at(-1), 'error');
  success = true;
  assert.equal(await queue.flush(), true);
  assert.equal(calls, 2);
  assert.equal(queue.dirty, false);
  queue.cancel();
});

test('invalid fields and unrelated mutations block autosave without dropping edits', async () => {
  let valid = false,
    calls = 0;
  const queue = new EntryAutosave(
    { title: 'original' },
    {
      save: async () => {
        calls++;
        return true;
      },
      valid: () => valid,
      status: () => {},
      delay: 5,
    },
  );
  queue.update({ title: '' });
  assert.equal(await queue.flush(), false);
  assert.equal(calls, 0);
  valid = true;
  queue.update({ title: 'valid' }, true);
  await pause();
  assert.equal(calls, 0);
  queue.update({ title: 'valid' }, false);
  await pause();
  assert.equal(calls, 1);
  assert.equal(queue.dirty, false);
  queue.cancel();
});

test('autosave serializes in-flight writes and keeps a newer edit pending', async () => {
  let finish!: (success: boolean) => void;
  const writes: unknown[] = [];
  const queue = new EntryAutosave(
    { title: 'original' },
    {
      save: (data) => {
        writes.push(data);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      valid: () => true,
      status: () => {},
      delay: 5,
    },
  );
  queue.update({ title: 'first' });
  const first = queue.flush();
  queue.update({ title: 'second' });
  assert.equal(writes.length, 1);
  finish(true);
  assert.equal(await first, false);
  assert.equal(queue.dirty, true);
  const second = queue.flush();
  assert.equal(writes.length, 2);
  finish(true);
  assert.equal(await second, true);
  assert.deepEqual(writes, [{ title: 'first' }, { title: 'second' }]);
  queue.cancel();
});

test('discard cancels a pending or failed draft without another write', async () => {
  let writes = 0;
  const queue = new EntryAutosave(
    { title: 'saved' },
    {
      save: async () => {
        writes++;
        return false;
      },
      valid: () => true,
      status: () => {},
      delay: 5,
    },
  );
  queue.update({ title: 'pending' });
  assert.equal(queue.discard(), true);
  await pause();
  assert.equal(writes, 0);
  queue.update({ title: 'failure' });
  await queue.flush();
  assert.equal(queue.dirty, true);
  assert.equal(queue.discard(), true);
  assert.equal(await queue.flush(), true);
  assert.equal(writes, 1);
  queue.cancel();
});
