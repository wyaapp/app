import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDesktopSession,
  desktopSessionKey,
  loadDesktopSession,
  needsSessionRestore,
  readDesktopSession,
  saveDesktopSession,
  sessionPoint,
  type DesktopSessionScope,
} from '../app/components/desktop-profile/desktop-session.ts';
import {
  clampWindow,
  initialWindows,
  windowReducer,
} from '../app/components/desktop-profile/window-state.ts';

const scope: DesktopSessionScope = { spaceId: 'space-one', mode: 'owner' };
const ids = ['about', 'files', 'paint', 'tab-home', 'file-document'];

test('metadata refresh does not reopen a session; only a scope change or initial error recovery does', () => {
  const key = desktopSessionKey(scope);
  assert.equal(needsSessionRestore(null, key, false), true);
  assert.equal(needsSessionRestore({ key, metadataFailed: false }, key, false), false);
  assert.equal(needsSessionRestore({ key, metadataFailed: false }, key, true), false);
  assert.equal(needsSessionRestore({ key, metadataFailed: true }, key, true), false);
  assert.equal(needsSessionRestore({ key, metadataFailed: true }, key, false), true);
  assert.equal(needsSessionRestore({ key, metadataFailed: false }, `${key}-visitor`, false), true);
});

test('desktop sessions restore open, minimized and maximized windows in their saved order', () => {
  let windows = initialWindows('tab-home', 'about');
  windows = windowReducer(windows, { type: 'open', id: 'files' });
  windows = windowReducer(windows, { type: 'maximize', id: 'files' });
  windows = windowReducer(windows, { type: 'hide', id: 'about' });
  windows = windowReducer(windows, { type: 'open', id: 'paint' });
  windows = windowReducer(windows, { type: 'close', id: 'paint' });
  const saved = createDesktopSession(scope, windows, { files: { x: 21, y: 45 } }, ids);
  const restored = readDesktopSession(JSON.stringify(saved), scope, ids)!;
  assert.deepEqual(restored.windows.running, ['tab-home', 'about', 'files']);
  assert.deepEqual(restored.windows.order, ['tab-home', 'files']);
  assert.deepEqual(restored.windows.maximized, ['files']);
  assert.ok(!restored.windows.loaded.includes('paint'));
  assert.deepEqual(restored.positions, { files: { x: 21, y: 45 } });
  assert.deepEqual(
    windowReducer(initialWindows('tab-home', 'about'), {
      type: 'restore',
      state: restored.windows,
    }),
    restored.windows,
  );
});

test('an intentionally empty desktop is restored rather than replaced with default windows', () => {
  const saved = createDesktopSession(
    scope,
    { loaded: ['about'], running: [], order: [], maximized: [] },
    { about: { x: 10, y: 20 } },
    ids,
  );
  const restored = readDesktopSession(JSON.stringify(saved), scope, ids);
  assert.ok(restored);
  assert.deepEqual(restored.windows, { loaded: [], running: [], order: [], maximized: [] });
  assert.deepEqual(restored.positions.about, { x: 10, y: 20 });
});

test('session keys and payload validation isolate spaces and owner/visitor modes', () => {
  const otherSpace = { ...scope, spaceId: 'space-two' };
  const visitor: DesktopSessionScope = { ...scope, mode: 'visitor' };
  assert.notEqual(desktopSessionKey(scope), desktopSessionKey(otherSpace));
  assert.notEqual(desktopSessionKey(scope), desktopSessionKey(visitor));
  assert.notEqual(
    desktopSessionKey({ ...scope, spaceId: 'a:b' }),
    desktopSessionKey({ ...scope, spaceId: 'a%3Ab' }),
  );
  const saved = JSON.stringify(
    createDesktopSession(scope, initialWindows('tab-home', 'about'), {}, ids),
  );
  assert.equal(readDesktopSession(saved, otherSpace, ids), null);
  assert.equal(readDesktopSession(saved, visitor, ids), null);
});

test('deleted and inaccessible windows are removed and invalid order/maximized entries cannot open apps', () => {
  const saved = JSON.stringify({
    version: 1,
    scope,
    windows: {
      loaded: ['owner-secret'],
      running: ['about', 'about', 'file-document', 'file-deleted', 'owner-secret', '../file'],
      order: ['paint', 'file-document', 'owner-secret', 'about', 'about'],
      maximized: ['files', 'file-document', 'file-deleted'],
    },
    positions: { about: { x: 4, y: 6 }, 'file-deleted': { x: 100, y: 100 } },
  });
  const restored = readDesktopSession(saved, scope, ids)!;
  assert.deepEqual(restored.windows, {
    loaded: ['about', 'file-document'],
    running: ['about', 'file-document'],
    order: ['file-document', 'about'],
    maximized: ['file-document'],
  });
  assert.deepEqual(restored.positions, { about: { x: 4, y: 6 } });
});

test('persistence retains only bounded window metadata and never app content', () => {
  const allIds = Array.from({ length: 150 }, (_, index) => `app-${index}`);
  const saved = createDesktopSession(
    scope,
    {
      loaded: allIds,
      running: allIds,
      order: allIds,
      maximized: allIds,
      content: 'private notes',
    } as Parameters<typeof createDesktopSession>[1],
    {
      'app-0': { x: 1e20, y: -90, content: 'private notes' } as { x: number; y: number },
      'app-1': { x: NaN, y: Infinity },
    },
    allIds,
  );
  assert.equal(saved.windows.running.length, 100);
  assert.equal(saved.windows.order.length, 100);
  assert.equal(saved.windows.maximized.length, 100);
  assert.deepEqual(saved.positions, { 'app-0': { x: 100_000, y: 0 } });
  assert.ok(!JSON.stringify(saved).includes('private notes'));
  assert.equal(sessionPoint({ x: '3', y: 5 }), null);
  assert.equal(sessionPoint({ x: Infinity, y: 5 }), null);
});

test('restored positions clamp to the current viewport while leaving title bars reachable', () => {
  const saved = sessionPoint({ x: 50_000, y: 80_000 })!;
  assert.deepEqual(clampWindow(saved, { width: 760, height: 900 }, { width: 1200, height: 800 }), {
    x: 1020,
    y: 752,
  });
  assert.deepEqual(
    clampWindow(
      { x: -50_000, y: -80_000 },
      { width: 760, height: 900 },
      { width: 1200, height: 800 },
    ),
    { x: -580, y: 0 },
  );
});

test('corrupt, oversized and unsupported sessions fall back without throwing', () => {
  const saved = createDesktopSession(scope, initialWindows('tab-home', 'about'), {}, ids);
  for (const raw of [
    null,
    '',
    '{',
    'null',
    '[]',
    '{}',
    'x'.repeat(65537),
    JSON.stringify({ ...saved, version: 2 }),
    JSON.stringify({ ...saved, windows: { running: 'about' } }),
  ])
    assert.equal(readDesktopSession(raw, scope, ids), null);
});

test('blocked or full browser storage does not prevent desktop use', () => {
  const blocked = {
    getItem() {
      throw new Error('Access denied');
    },
    setItem() {
      throw new Error('Quota exceeded');
    },
  };
  const saved = createDesktopSession(scope, initialWindows('tab-home', 'about'), {}, ids);
  assert.equal(loadDesktopSession(blocked, scope, ids), null);
  assert.equal(saveDesktopSession(blocked, saved), false);
  assert.equal(loadDesktopSession(null, scope, ids), null);
  assert.equal(saveDesktopSession(null, saved), false);
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  };
  assert.equal(saveDesktopSession(storage, saved), true);
  assert.equal(JSON.parse(memory.get(desktopSessionKey(scope))!).windows.loaded, undefined);
  assert.deepEqual(loadDesktopSession(storage, scope, ids), saved);
});
