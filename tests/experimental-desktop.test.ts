import test from 'node:test';
import assert from 'node:assert/strict';
import {
  windowReducer as desktopReducer,
  initialWindows,
} from '../app/components/desktop-profile/window-state.ts';
const initialDesktop = () => initialWindows('tab-home', 'about');
import { normalizeHandle } from '../lib/profile-validation.ts';

test('minimizing and closing windows preserve mounted drafts and restore their place in the taskbar', () => {
  let state = initialDesktop();
  state = desktopReducer(state, { type: 'open', id: 'profile' });
  state = desktopReducer(state, { type: 'hide', id: 'profile' });
  assert.equal(state.order.at(-1), 'about');
  assert.ok(state.running.includes('profile'));
  assert.ok(state.loaded.includes('profile'));
  state = desktopReducer(state, { type: 'close', id: 'profile' });
  assert.ok(!state.running.includes('profile'));
  assert.ok(state.loaded.includes('profile'));
  state = desktopReducer(state, { type: 'open', id: 'profile' });
  assert.equal(state.order.at(-1), 'profile');
  assert.equal(state.running.filter((id) => id === 'profile').length, 1);
  assert.equal(state.loaded.filter((id) => id === 'profile').length, 1);
});

test('show desktop retains apps and maximizing restores without affecting other windows', () => {
  let state = desktopReducer(initialDesktop(), { type: 'maximize', id: 'links' });
  state = desktopReducer(state, { type: 'open', id: 'tab-games' });
  assert.deepEqual(state.maximized, ['links']);
  state = desktopReducer(state, { type: 'clear' });
  assert.deepEqual(state.order, []);
  assert.deepEqual(state.running, ['tab-home', 'about', 'links', 'tab-games']);
  state = desktopReducer(state, { type: 'open', id: 'links' });
  assert.deepEqual(state.maximized, ['links']);
  state = desktopReducer(state, { type: 'maximize', id: 'links' });
  assert.deepEqual(state.maximized, []);
  assert.deepEqual(initialDesktop().loaded, ['tab-home', 'about']);
});

test('the experimental app route cannot be claimed as a public space handle', () => {
  assert.throws(() => normalizeHandle('experimental-dashboard'));
  assert.throws(() => normalizeHandle('@Experimental-Dashboard'));
});
