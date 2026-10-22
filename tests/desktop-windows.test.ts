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

test('dragging and a shrinking viewport keep windows inside the available workspace', () => {
  const window = { width: 420, height: 400 };
  const workspace = { width: 1000, height: 600 };
  assert.deepEqual(clampWindow({ x: -400, y: -50 }, window, workspace), { x: 16, y: 16 });
  assert.deepEqual(clampWindow({ x: 9999, y: 9999 }, window, workspace), { x: 564, y: 184 });
  assert.deepEqual(clampWindow({ x: 132, y: 54 }, window, workspace), { x: 132, y: 54 });
  assert.deepEqual(clampWindow({ x: 564, y: 184 }, window, { width: 700, height: 500 }), {
    x: 264,
    y: 84,
  });
});
