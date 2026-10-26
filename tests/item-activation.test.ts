import test from 'node:test';
import assert from 'node:assert/strict';
import { createItemActivation } from '../lib/item-activation.ts';

const click = (timeStamp: number, clientX = 30, clientY = 40, detail = 1) => ({
  timeStamp,
  clientX,
  clientY,
  detail,
});

test('mouse clicks only select; the native double-click opens once', () => {
  const item = createItemActivation();
  item.pointerDown('mouse');
  assert.equal(item.click(click(100), false), false);
  assert.equal(item.click(click(200, 30, 40, 2), true), false);
  assert.equal(item.doubleClick(), true);
});

test('touch and pen open on the second nearby tap, without opening again on synthetic dblclick', () => {
  for (const pointer of ['touch', 'pen']) {
    const item = createItemActivation();
    item.pointerDown(pointer);
    assert.equal(item.click(click(100), false), false);
    assert.equal(item.click(click(300, 35, 44), true), true);
    assert.equal(item.doubleClick(), false);
    assert.equal(item.click(click(400), true), false);
  }
});

test('slow, distant, deselected and cancelled taps cannot open an item', () => {
  for (const second of [click(700), click(250, 80), click(250, 30, 90), click(50)]) {
    const item = createItemActivation();
    item.pointerDown('touch');
    item.click(click(100), false);
    assert.equal(item.click(second, true), false);
  }
  const item = createItemActivation();
  item.pointerDown('touch');
  item.click(click(100), false);
  assert.equal(item.click(click(200), false), false);
  item.cancel(); // Blur, scrolling or a context menu cancels the pending gesture.
  assert.equal(item.click(click(300), true), false);
});

test('keyboard-generated clicks and switching pointer devices do not reuse a pending touch tap', () => {
  const item = createItemActivation();
  item.pointerDown('touch');
  item.click(click(100), false);
  assert.equal(item.click(click(200, 0, 0, 0), true), false);
  assert.equal(item.click(click(250), true), false);
  item.pointerDown('mouse');
  assert.equal(item.click(click(300), true), false);
  assert.equal(item.doubleClick(), true);
});
