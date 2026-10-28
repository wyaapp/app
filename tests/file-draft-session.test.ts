import test from 'node:test';
import assert from 'node:assert/strict';
import { FileDraftSession } from '../lib/file-draft-session.ts';
import type { FileAction, SpaceFile } from '../lib/space-files.ts';

const initial: SpaceFile = {
  id: 'bcb5c8b5-0d87-4765-84ac-13ea80e68695',
  name: 'Socials.md',
  content: '# Socials\n',
  version: 21,
  folderId: null,
  size: 10,
  published: true,
  hasChanges: false,
  pinned: false,
  updatedAt: '2026-10-28T12:00:00.000Z',
  appearance: {},
};
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function fixture() {
  const requests: FileAction[] = [];
  let server = { ...initial };
  const change = async (action: FileAction) => {
    requests.push(action);
    assert.ok('version' in action);
    assert.equal(action.version, server.version);
    if (action.action === 'delete') return undefined;
    server = {
      ...server,
      version: server.version + 1,
      ...(action.action === 'save'
        ? {
            name: action.name,
            content: action.content,
            appearance: action.appearance,
            hasChanges: true,
          }
        : {}),
      ...(action.action === 'publish' ? { published: true, hasChanges: false } : {}),
      ...(action.action === 'unpublish' ? { published: false } : {}),
      ...(action.action === 'pin' ? { pinned: action.pinned } : {}),
      ...(action.action === 'move' ? { folderId: action.folderId } : {}),
    };
    return server;
  };
  return { session: new FileDraftSession(initial, change), requests, change };
}

test('editing text, names and appearance stays local until an explicit Save', async () => {
  const { session, requests } = fixture();
  for (let i = 0; i < 100; i++) session.edit({ content: `# Local ${i}\n` });
  session.edit({ name: 'Draft.md', appearance: { theme: 'dim' } });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(requests.length, 0);
  assert.equal(session.dirty, true);
  assert.equal(await session.save(), true);
  assert.deepEqual(requests, [
    {
      action: 'save',
      id: initial.id,
      version: 21,
      name: 'Draft.md',
      content: '# Local 99\n',
      appearance: { theme: 'dim' },
    },
  ]);
  assert.equal(session.dirty, false);
  assert.equal(session.saved.version, 22);
});

test('untouched and reverted drafts do not send redundant saves', async () => {
  const { session, requests } = fixture();
  assert.equal(await session.save(), true);
  session.edit({ content: 'temporary' });
  session.edit({ content: initial.content, appearance: {} });
  assert.equal(await session.save(), true);
  assert.equal(requests.length, 0);
});

test('unchanged editor updates keep the same draft and do not notify subscribers', () => {
  const { session, requests } = fixture();
  let notifications = 0;
  session.subscribe(() => {
    notifications++;
  });
  const original = session.draft;
  for (let i = 0; i < 100; i++) {
    session.edit({ content: initial.content });
    session.edit({ name: initial.name, appearance: {} });
  }
  assert.equal(session.draft, original);
  assert.equal(notifications, 0);
  assert.equal(requests.length, 0);
  session.edit({ content: 'changed once' });
  const changed = session.draft;
  session.edit({ content: 'changed once' });
  assert.equal(session.draft, changed);
  assert.equal(notifications, 1);
});

test('Save snapshots once, coalesces repeated clicks and leaves newer edits pending', async () => {
  const { session, requests, change } = fixture();
  let finish!: () => void;
  session.configure(async (action) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return change(action);
  });
  session.edit({ content: 'clicked snapshot' });
  const first = session.save();
  assert.equal(session.save(), first);
  await tick();
  session.edit({ content: 'typed while saving' });
  assert.equal(session.save(), first);
  assert.equal(await session.manage('pin'), false, 'unrelated mutations are not silently queued');
  finish();
  assert.equal(await first, false);
  assert.equal(requests.length, 1);
  assert.equal(session.saved.content, 'clicked snapshot');
  assert.equal(session.draft.content, 'typed while saving');
  assert.equal(session.dirty, true);
  assert.equal(session.saving, false);
  session.configure(change);
  assert.equal(await session.save(), true);
  assert.equal(requests.length, 2);
  assert.equal(session.saved.version, 23);
});

test('failed saves preserve edits and require an explicit retry', async () => {
  let requests = 0;
  const session = new FileDraftSession(initial, async () => {
    requests++;
    throw new Error('Too many file requests. Wait a moment and try again.');
  });
  session.edit({ content: 'keep this draft' });
  assert.equal(await session.save(), false);
  assert.match(session.error, /Too many file requests/);
  session.edit({ content: 'keep this newer draft too' });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(requests, 1);
  assert.equal(session.saved, initial);
  assert.equal(session.dirty, true);
  session.configure(async (action) => {
    requests++;
    assert.equal(action.action, 'save');
    return { ...initial, content: session.draft.content, version: 22 };
  });
  assert.equal(await session.save(), true);
  assert.equal(requests, 2);
});

test('invalid or unconfirmed saves cannot mark a draft as saved', async () => {
  const { session, requests } = fixture();
  session.edit({ name: 'invalid.zip', content: 'local' });
  assert.equal(await session.save(), false);
  assert.equal(requests.length, 0);
  session.edit({ name: 'valid.md' });
  session.configure(async () => undefined);
  assert.equal(await session.save(), false);
  assert.match(session.error, /Could not confirm/);
  assert.equal(session.saved.version, 21);
  assert.equal(session.dirty, true);
});

test('nonoverlapping external versions update clean fields without replacing local edits', () => {
  const { session } = fixture();
  session.edit({ content: 'local content', appearance: { theme: 'black' } });
  session.accept({
    ...initial,
    version: 22,
    name: 'Renamed.md',
    pinned: true,
  });
  assert.equal(session.draft.name, 'Renamed.md');
  assert.equal(session.draft.content, 'local content');
  assert.deepEqual(session.draft.appearance, { theme: 'black' });
  assert.equal(session.saved.pinned, true);
  session.accept(initial);
  session.accept({ ...initial, id: 'different-file', version: 100 });
  assert.equal(session.saved.version, 22);
});

test('overlapping external changes retain the old version and block writes until reopening', async () => {
  for (const [local, remote] of [
    [{ content: 'my text' }, { content: 'their text' }],
    [{ name: 'Mine.md' }, { name: 'Theirs.md' }],
    [{ appearance: { theme: 'black' as const } }, { appearance: { theme: 'dim' as const } }],
  ]) {
    const { session, requests } = fixture();
    session.edit(local);
    const before = session.draft;
    session.accept({ ...initial, ...remote, version: 22 });
    assert.equal(session.saved.version, 21);
    assert.equal(session.draft, before);
    const conflict = session.error;
    assert.match(conflict, /changed elsewhere.*recover your local draft/);
    session.edit({ content: 'continuing locally is safe' });
    assert.equal(session.error, conflict);
    session.accept({ ...initial, version: 23 });
    assert.equal(session.saved.version, 21);
    assert.equal(await session.save(), false);
    assert.equal(await session.manage('publish'), false);
    assert.equal(await session.manage('pin'), false);
    assert.equal(await session.manage('delete'), false);
    assert.equal(await session.rename('New.md'), false);
    assert.equal(requests.length, 0);
  }
});

test('clean external updates and identical edits do not create a conflict', async () => {
  const { session, requests } = fixture();
  session.accept({ ...initial, content: 'remote edit', version: 22 });
  assert.equal(session.draft.content, 'remote edit');
  assert.equal(session.error, '');
  session.edit({ content: 'same edit' });
  session.accept({ ...initial, content: 'same edit', version: 23 });
  assert.equal(session.saved.version, 23);
  assert.equal(session.dirty, false);
  assert.equal(await session.save(), true);
  assert.equal(requests.length, 0);
});

test('our acknowledged response arriving through props does not conflict with later typing', async () => {
  const { session, change, requests } = fixture();
  session.configure(async (action) => {
    session.edit({ content: 'typed while saving' });
    const response = await change(action);
    session.accept(response!);
    return response;
  });
  session.edit({ content: 'clicked snapshot' });
  assert.equal(await session.save(), false);
  assert.equal(session.error, '');
  assert.equal(session.saved.version, 22);
  assert.equal(session.draft.content, 'typed while saving');
  session.configure(change);
  assert.equal(await session.save(), true);
  assert.equal(requests.length, 2);
});

test('a genuinely newer external response during Save still blocks a conflicting later edit', async () => {
  const { session, change, requests } = fixture();
  session.configure(async (action) => {
    const response = await change(action);
    session.edit({ content: 'newer local text' });
    session.accept({ ...response!, version: 23, content: 'newer external text' });
    return response;
  });
  session.edit({ content: 'clicked snapshot' });
  assert.equal(await session.save(), false);
  assert.equal(session.saved.version, 22);
  assert.equal(session.saved.content, 'clicked snapshot');
  assert.equal(session.draft.content, 'newer local text');
  assert.match(session.error, /changed elsewhere/);
  assert.equal(await session.save(), false);
  assert.equal(requests.length, 1);
});

test('publication saves once then uses the acknowledged version', async () => {
  const { session, requests } = fixture();
  session.edit({ content: 'ready to publish' });
  const first = session.manage('publish');
  assert.equal(session.manage('publish'), first);
  assert.equal(await first, true);
  assert.deepEqual(
    requests.map((action) => [action.action, 'version' in action && action.version]),
    [
      ['save', 21],
      ['publish', 22],
    ],
  );
  assert.equal(session.saved.hasChanges, false);
  assert.equal(await session.manage('publish'), true);
  assert.equal(requests.length, 2);
});

test('publication never drains or publishes edits typed during its save', async () => {
  const { session, requests, change } = fixture();
  let finish!: () => void;
  session.configure(async (action) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return change(action);
  });
  session.edit({ content: 'first' });
  const publishing = session.manage('publish');
  await tick();
  session.edit({ content: 'later' });
  finish();
  assert.equal(await publishing, false);
  assert.deepEqual(
    requests.map((action) => action.action),
    ['save'],
  );
  assert.equal(session.draft.content, 'later');
  assert.equal(session.dirty, true);
  assert.match(session.error, /Newer changes are still unsaved/);
});

test('metadata actions do not submit unsaved text or appearance', async () => {
  const { session, requests } = fixture();
  session.edit({ content: 'unsubmitted', appearance: { theme: 'dim' } });
  assert.equal(await session.manage('pin'), true);
  assert.equal(await session.manage('move', 'bcb5c8b5-0d87-4765-84ac-13ea80e68694'), true);
  assert.equal(await session.manage('unpublish'), true);
  assert.deepEqual(
    requests.map((action) => action.action),
    ['pin', 'move', 'unpublish'],
  );
  assert.equal(session.draft.content, 'unsubmitted');
  assert.deepEqual(session.draft.appearance, { theme: 'dim' });
  assert.equal(session.saved.content, initial.content);
  assert.equal(session.dirty, true);
});

test('rename sends one request with saved content and preserves pending edits', async () => {
  const { session, requests } = fixture();
  session.edit({ content: 'unsubmitted', appearance: { theme: 'dim' } });
  assert.equal(await session.rename(' Renamed.md '), true);
  assert.deepEqual(requests, [
    {
      action: 'save',
      id: initial.id,
      version: 21,
      name: 'Renamed.md',
      content: initial.content,
      appearance: {},
    },
  ]);
  assert.equal(session.draft.name, 'Renamed.md');
  assert.equal(session.draft.content, 'unsubmitted');
  assert.deepEqual(session.draft.appearance, { theme: 'dim' });
  assert.equal(await session.rename('Renamed.md'), true);
  assert.equal(requests.length, 1);
});

test('a failed rename rolls back only its proposed name', async () => {
  let finish!: () => void;
  const session = new FileDraftSession(initial, async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    throw new Error('Name already exists.');
  });
  const renamed = session.rename('Taken.md');
  await tick();
  session.edit({ content: 'typed during rename' });
  finish();
  assert.equal(await renamed, false);
  assert.equal(session.draft.name, initial.name);
  assert.equal(session.draft.content, 'typed during rename');
  assert.match(session.error, /Name already exists/);
});

test('explicit Trash keeps unsaved content in the restorable server copy', async () => {
  const { session, requests } = fixture();
  session.edit({ content: 'restore this later' });
  assert.equal(await session.manage('delete'), true);
  assert.deepEqual(
    requests.map((action) => action.action),
    ['save', 'delete'],
  );
  assert.equal(session.saved.content, 'restore this later');
});

test('subscribers see editing and saving transitions and can unsubscribe', async () => {
  const { session } = fixture();
  const states: boolean[] = [];
  const unsubscribe = session.subscribe(() => {
    states.push(session.saving);
  });
  session.edit({ content: 'changed' });
  await session.save();
  assert.deepEqual(states, [false, true, false]);
  unsubscribe();
  session.edit({ content: 'another' });
  assert.equal(states.length, 3);
});
