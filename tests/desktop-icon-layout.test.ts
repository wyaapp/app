import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESKTOP_ICON,
  readIconPositions,
  readDesktopGridPositions,
  serializeDesktopGridPositions,
  desktopIconPositions,
  desktopIconDrop,
  desktopGridPositions,
  snapDesktopIconPoint,
  moveDesktopGridIcon,
  type IconPositions,
} from '../lib/desktop-icon-layout.ts';

test('grid slots use a square pitch aligned with four wallpaper cells', () => {
  assert.equal(DESKTOP_ICON.width + DESKTOP_ICON.gap, DESKTOP_ICON.dot * 4);
  assert.equal(DESKTOP_ICON.height + DESKTOP_ICON.gap, DESKTOP_ICON.dot * 4);
});

test('legacy grid storage preserves columns when migrating to square slots', () => {
  const legacy = {
    files: { x: 20, y: 28 },
    about: { x: 104, y: 116 },
    distant: { x: 1112, y: 292 },
  };
  const raw = JSON.stringify(legacy);
  const migrated = readDesktopGridPositions(raw);
  assert.deepEqual(migrated, {
    files: { x: 20, y: 28 },
    about: { x: 108, y: 116 },
    distant: { x: 1164, y: 292 },
  });
  // Free positioning keeps its original pixel coordinates.
  assert.deepEqual(readIconPositions(raw), legacy);
});

test('versioned grid storage round trips without migrating positions twice', () => {
  const positions = { files: { x: 1164, y: 292 }, about: { x: 196, y: 28 } };
  const serialized = serializeDesktopGridPositions(positions);
  assert.deepEqual(JSON.parse(serialized), { version: 2, positions });
  assert.deepEqual(readDesktopGridPositions(serialized), positions);
  assert.deepEqual(
    readDesktopGridPositions(serializeDesktopGridPositions(readDesktopGridPositions(serialized))),
    positions,
  );
  for (const raw of [null, '{', 'null', '[]', '{"version":3,"positions":{}}'])
    assert.deepEqual(readDesktopGridPositions(raw), {});
});

test('desktop placement preserves the grab point without snapping to the grid', () => {
  assert.deepEqual(
    desktopIconDrop(
      { x: 483, y: 342 },
      { x: 19, y: 31 },
      { left: 100, top: 50, width: 1200, height: 800 },
    ),
    { x: 364, y: 261 },
  );
  assert.deepEqual(
    desktopIconDrop(
      { x: -50, y: 2000 },
      { x: 19, y: 31 },
      { left: 100, top: 50, width: 1200, height: 800 },
    ),
    { x: DESKTOP_ICON.edge, y: 800 - DESKTOP_ICON.height - DESKTOP_ICON.edge },
  );
});

test('grid placement preserves the grab offset before snapping and clamps to complete slots', () => {
  const size = { width: 1200, height: 800 };
  const dropped = desktopIconDrop(
    { x: 483, y: 342 },
    { x: 19, y: 31 },
    { left: 100, top: 50, ...size },
  );
  assert.deepEqual(snapDesktopIconPoint(dropped, size), { x: 372, y: 292 });
  assert.deepEqual(snapDesktopIconPoint({ x: -1000, y: -1000 }, size), { x: 20, y: 28 });
  assert.deepEqual(snapDesktopIconPoint({ x: 5000, y: 5000 }, size), { x: 1076, y: 644 });
});

test('grid mode starts in the automatic column layout and fills holes for new icons', () => {
  const size = { width: 1200, height: 420 };
  const ids = ['files', 'about', 'settings', 'games', 'paint'];
  const initial = desktopGridPositions(ids, {}, size);
  assert.deepEqual(initial, desktopIconPositions(ids, {}, size));
  const moved = moveDesktopGridIcon(ids, initial, 'files', { x: 460, y: 204 }, size);
  const next = desktopGridPositions([...ids, 'calculator'], moved, size);
  for (const id of ids) assert.deepEqual(next[id], moved[id]);
  assert.deepEqual(next.calculator, initial.files);
});

test('dropping on an occupied slot swaps only those two shortcuts', () => {
  const size = { width: 1200, height: 800 };
  const ids = ['files', 'about', 'settings', 'games'];
  const initial = desktopGridPositions(ids, {}, size);
  const before = structuredClone(initial);
  const moved = moveDesktopGridIcon(ids, initial, 'files', { x: 24, y: 111 }, size);
  assert.deepEqual(moved, { ...initial, files: initial.about, about: initial.files });
  assert.deepEqual(initial, before);
  assert.deepEqual(moveDesktopGridIcon(ids, moved, 'files', moved.files, size), moved);
});

test('an incoming file displaces only the target occupant to its nearest vacant slot', () => {
  const size = { width: 1200, height: 800 };
  const ids = ['files', 'about', 'settings'];
  const initial = desktopGridPositions(ids, {}, size);
  const next = moveDesktopGridIcon(ids, initial, 'new-file', initial.settings, size);
  assert.deepEqual(next, {
    files: initial.files,
    about: initial.about,
    settings: { x: 20, y: 292 },
    'new-file': initial.settings,
  });
  const emptyTarget = { x: 196, y: 116 };
  assert.deepEqual(moveDesktopGridIcon(ids, initial, 'another-file', emptyTarget, size), {
    ...initial,
    'another-file': emptyTarget,
  });
});

test('a smaller grid preserves visible icons, relocates collisions, and restores saved slots', () => {
  const saved = {
    files: { x: 460, y: 292 },
    about: { x: 108, y: 28 },
    settings: { x: 460, y: 28 },
    games: { x: 20, y: 116 },
  };
  const before = structuredClone(saved);
  const ids = Object.keys(saved);
  assert.deepEqual(desktopGridPositions(ids, saved, { width: 196, height: 332 }), {
    files: { x: 108, y: 116 },
    about: saved.about,
    settings: { x: 20, y: 28 },
    games: saved.games,
  });
  assert.deepEqual(saved, before);
  assert.deepEqual(desktopGridPositions(ids, saved, { width: 1200, height: 800 }), saved);
});

test('grid layout repairs duplicate slots deterministically and omits stale icons', () => {
  const size = { width: 1200, height: 800 };
  const ids = ['files', 'about', 'games'];
  const saved = {
    files: { x: 20, y: 28 },
    about: { x: 20, y: 28 },
    games: { x: 108, y: 116 },
    removed: { x: 108, y: 28 },
  };
  const placed = desktopGridPositions(ids, saved, size);
  assert.deepEqual(placed, {
    files: saved.files,
    about: { x: 20, y: 116 },
    games: saved.games,
  });
  assert.deepEqual(desktopGridPositions(ids, saved, size), placed);
  assert.deepEqual(desktopGridPositions(ids, placed, size), placed);
});

test('a full grid continues in distinct scrollable slots and keeps overflow swaps stable', () => {
  const size = { width: 196, height: 332 };
  const ids = ['files', 'about', 'settings', 'games', 'paint', 'calculator'];
  const initial = desktopGridPositions(ids, {}, size);
  assert.deepEqual(initial.paint, { x: 196, y: 28 });
  assert.deepEqual(initial.calculator, { x: 196, y: 116 });
  assert.equal(new Set(Object.values(initial).map(({ x, y }) => `${x}:${y}`)).size, ids.length);
  const moved = moveDesktopGridIcon(ids, initial, 'calculator', initial.files, size);
  const expected: IconPositions = {
    ...initial,
    calculator: initial.files,
    files: initial.calculator,
  };
  assert.deepEqual(moved, expected);
  assert.deepEqual(desktopGridPositions(ids, moved, size), moved);
  const incoming = moveDesktopGridIcon(ids, moved, 'incoming', moved.about, size);
  assert.deepEqual(incoming.incoming, moved.about);
  assert.equal(
    new Set(Object.values(incoming).map(({ x, y }) => `${x}:${y}`)).size,
    ids.length + 1,
  );
});

test('a drop into a scrolled overflow column uses content coordinates and swaps only its occupant', () => {
  const viewport = { width: 196, height: 332 };
  const ids = ['files', 'about', 'settings', 'games', 'paint', 'calculator'];
  const initial = desktopGridPositions(ids, {}, viewport);
  const contentWidth = Math.max(
    viewport.width,
    ...Object.values(initial).map(({ x }) => x + DESKTOP_ICON.width + DESKTOP_ICON.edge),
  );
  const scrollLeft = DESKTOP_ICON.width + DESKTOP_ICON.gap;
  const bounds = { left: 100, top: 50, width: contentWidth, height: viewport.height };
  const grab = { x: 19, y: 31 };
  const pointer = {
    x: bounds.left + initial.calculator.x - scrollLeft + grab.x,
    y: bounds.top + initial.calculator.y + grab.y,
  };
  const dropped = desktopIconDrop(pointer, grab, {
    ...bounds,
    left: bounds.left - scrollLeft,
  });
  assert.deepEqual(dropped, { x: 196, y: 116 });
  const moved = moveDesktopGridIcon(ids, initial, 'files', dropped, {
    width: contentWidth,
    height: viewport.height,
  });
  const expected: IconPositions = {
    ...initial,
    files: initial.calculator,
    calculator: initial.files,
  };
  assert.deepEqual(moved, expected);
  assert.deepEqual(moved.games, initial.games);
});

test('an empty overflow slot keeps its saved icon instead of compacting a deliberate viewport gap', () => {
  const viewport = { width: 1000, height: 360 };
  const ids = Array.from({ length: 35 }, (_, index) => `icon${index}`);
  const initial = desktopGridPositions(ids, {}, viewport);
  const target = { x: 988, y: 204 };
  const moved = moveDesktopGridIcon(ids, initial, 'icon0', target, {
    width: target.x + DESKTOP_ICON.width + DESKTOP_ICON.edge,
    height: viewport.height,
  });
  const expected: IconPositions = { ...initial, icon0: target };
  assert.deepEqual(moved, expected);
  const rendered = desktopGridPositions(ids, moved, viewport);
  assert.deepEqual(rendered, moved);
  assert.equal(
    Object.values(rendered).some(({ x, y }) => x === initial.icon0.x && y === initial.icon0.y),
    false,
  );
});

test('default icons fill columns while new icons avoid freely positioned shortcuts', () => {
  const size = { width: 1200, height: 420 };
  const ids = ['files', 'about', 'settings', 'games', 'paint'];
  const initial = desktopIconPositions(ids, {}, size);
  assert.deepEqual(initial.files, { x: 20, y: 28 });
  assert.deepEqual(initial.about, { x: 20, y: 116 });
  assert.deepEqual(initial.paint, { x: 108, y: 116 });
  const moved: IconPositions = { ...initial, files: { x: 557, y: 193 } };
  const next = desktopIconPositions([...ids, 'calculator'], moved, size);
  for (const id of ids) assert.deepEqual(next[id], moved[id]);
  assert.deepEqual(next.calculator, { x: 20, y: 28 });
});

test('resizing keeps icons reachable without destroying their saved positions', () => {
  const saved = { files: { x: 1700, y: 920 } };
  const smaller = desktopIconPositions(['files'], saved, { width: 1100, height: 600 });
  assert.deepEqual(smaller.files, { x: 1012, y: 512 });
  assert.deepEqual(desktopIconPositions(['files'], saved, { width: 1920, height: 1080 }), saved);
});

test('invalid browser storage is ignored and only current icons are laid out', () => {
  for (const raw of [null, '{', 'null', '[]', '0']) assert.deepEqual(readIconPositions(raw), {});
  const saved = readIconPositions(
    JSON.stringify({
      files: { x: 431.2, y: 180.9 },
      gone: { x: 10, y: 10 },
      bad: { x: '200', y: 3 },
      negative: { x: -1, y: 5 },
      huge: { x: 1e7, y: 5 },
      array: [],
      'bad/id': { x: 4, y: 5 },
    }),
  );
  assert.deepEqual(saved, { files: { x: 431, y: 181 }, gone: { x: 10, y: 10 } });
  assert.deepEqual(desktopIconPositions(['files'], saved, { width: 1200, height: 800 }), {
    files: saved.files,
  });
});
