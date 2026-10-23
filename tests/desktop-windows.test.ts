import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialWindows,
  windowReducer,
  clampWindow,
} from '../app/components/desktop-profile/window-state.ts';

test('opening, hiding and reopening windows retains a valid frontmost window', () => {
  let state = initialWindows('tab-home', 'about');
  assert.deepEqual(state.order, ['tab-home', 'about']);
  state = windowReducer(state, { type: 'open', id: 'tab-games' });
  state = windowReducer(state, { type: 'maximize', id: 'tab-games' });
  state = windowReducer(state, { type: 'open', id: 'about' });
  assert.deepEqual(state.order, ['tab-home', 'tab-games', 'about']);
  state = windowReducer(state, { type: 'hide', id: 'about' });
  assert.equal(state.order.at(-1), 'tab-games');
  state = windowReducer(state, { type: 'clear' });
  assert.deepEqual(state.order, []);
  state = windowReducer(state, { type: 'open', id: 'tab-games' });
  assert.deepEqual(state.maximized, ['tab-games']);
  state = windowReducer(state, { type: 'maximize', id: 'tab-games' });
  assert.deepEqual(state.maximized, []);
  state = windowReducer(state, { type: 'reset', firstTab: 'tab-home', active: 'about' });
  assert.deepEqual(state, initialWindows('tab-home', 'about'));
});

test('a directly selected tab opens in front without duplicated window entries', () => {
  assert.deepEqual(initialWindows('tab-games', 'tab-games').order, ['about', 'tab-games']);
  const state = initialWindows('tab-home', 'about');
  assert.equal(windowReducer(state, { type: 'open', id: 'about' }), state);
});

test('focus raises only visible windows and never launches an app', () => {
  const initial = initialWindows('tab-home', 'about');
  const focused = windowReducer(initial, { type: 'focus', id: 'tab-home' });
  assert.deepEqual(focused.order, ['about', 'tab-home']);
  assert.equal(focused.running, initial.running);
  assert.equal(focused.loaded, initial.loaded);
  assert.equal(windowReducer(focused, { type: 'focus', id: 'tab-home' }), focused);
  assert.equal(windowReducer(focused, { type: 'focus', id: 'paint' }), focused);
});

test('late focus after close cannot restore a cached window or its taskbar entry', () => {
  let state = initialWindows('tab-home', 'about');
  state = windowReducer(state, { type: 'open', id: 'paint' });
  state = windowReducer(state, { type: 'close', id: 'paint' });
  assert.equal(state.loaded.includes('paint'), true);
  assert.equal(state.running.includes('paint'), false);
  assert.equal(state.order.includes('paint'), false);
  assert.equal(windowReducer(state, { type: 'focus', id: 'paint' }), state);
  const reopened = windowReducer(state, { type: 'open', id: 'paint' });
  assert.equal(reopened.running.includes('paint'), true);
  assert.equal(reopened.order.at(-1), 'paint');
  assert.equal(reopened.loaded.filter((id) => id === 'paint').length, 1);
});

test('minimize and show desktop retain running apps without late focus reopening them', () => {
  const initial = initialWindows('tab-home', 'about');
  const minimized = windowReducer(initial, { type: 'hide', id: 'about' });
  assert.equal(minimized.running.includes('about'), true);
  assert.equal(minimized.order.includes('about'), false);
  assert.equal(windowReducer(minimized, { type: 'focus', id: 'about' }), minimized);
  const cleared = windowReducer(minimized, { type: 'clear' });
  assert.equal(cleared.running, initial.running);
  assert.deepEqual(cleared.order, []);
  assert.equal(windowReducer(cleared, { type: 'focus', id: 'tab-home' }), cleared);
  const restored = windowReducer(cleared, { type: 'open', id: 'about' });
  assert.deepEqual(restored.order, ['about']);
});

test('windows can reach the screen edges and move partially outside the workspace', () => {
  const window = { width: 420, height: 400 };
  const workspace = { width: 1000, height: 600 };
  assert.deepEqual(clampWindow({ x: 0, y: 0 }, window, workspace), { x: 0, y: 0 });
  assert.deepEqual(clampWindow({ x: -100, y: 350 }, window, workspace), { x: -100, y: 350 });
  assert.deepEqual(clampWindow({ x: 700, y: 500 }, window, workspace), { x: 700, y: 500 });
  assert.deepEqual(clampWindow({ x: 132, y: 54 }, window, workspace), { x: 132, y: 54 });
});

test('dragging beyond the screen and resizing leave a reachable title bar', () => {
  const window = { width: 420, height: 400 };
  const workspace = { width: 1000, height: 600 };
  assert.deepEqual(clampWindow({ x: -9999, y: -9999 }, window, workspace), { x: -240, y: 0 });
  assert.deepEqual(clampWindow({ x: 9999, y: 9999 }, window, workspace), { x: 820, y: 552 });
  assert.deepEqual(clampWindow({ x: 820, y: 552 }, window, { width: 700, height: 500 }), {
    x: 520,
    y: 452,
  });
});

test('a tall editor can move down without its content height pinning it to the top', () => {
  assert.deepEqual(
    clampWindow({ x: 100, y: 300 }, { width: 760, height: 740 }, { width: 1440, height: 800 }),
    {
      x: 100,
      y: 300,
    },
  );
});
