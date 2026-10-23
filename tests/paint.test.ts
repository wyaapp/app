import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyPaint,
  paintReducer,
  paintPoint,
  MAX_PAINT_STROKES,
  MAX_STROKE_POINTS,
  type PaintStroke,
} from '../lib/paint.ts';

const stroke: PaintStroke = {
  id: 'one',
  tool: 'pencil',
  color: '#1c1b1a',
  size: 6,
  points: [{ x: 10, y: 20 }],
};

test('painting, erasing, undo, redo and clear preserve immutable drawing history', () => {
  const initial = emptyPaint();
  let state = paintReducer(initial, { type: 'stroke', stroke });
  const drawn = state.strokes;
  state = paintReducer(state, {
    type: 'stroke',
    stroke: { ...stroke, id: 'erase', tool: 'eraser' },
  });
  state = paintReducer(state, { type: 'undo' });
  assert.deepEqual(state.strokes, [stroke]);
  state = paintReducer(state, { type: 'redo' });
  assert.equal(state.strokes[1].tool, 'eraser');
  const erased = state.strokes;
  state = paintReducer(state, { type: 'clear' });
  assert.equal(state.strokes.length, 0);
  state = paintReducer(state, { type: 'undo' });
  assert.deepEqual(state.strokes, erased);
  assert.deepEqual(drawn, [stroke]);
  assert.deepEqual(initial, emptyPaint());
});

test('new drawing after undo replaces the redo branch and caps history', () => {
  let state = paintReducer(emptyPaint(), { type: 'stroke', stroke });
  state = paintReducer(state, { type: 'undo' });
  state = paintReducer(state, { type: 'stroke', stroke: { ...stroke, id: 'replacement' } });
  assert.equal(state.future.length, 0);
  assert.equal(paintReducer(state, { type: 'redo' }), state);
  for (let index = 0; index < 60; index++)
    state = paintReducer(state, { type: 'stroke', stroke: { ...stroke, id: `${index}` } });
  assert.equal(state.past.length, 40);
});

test('canvas limits bound stroke data while still allowing clear and undo', () => {
  let state = emptyPaint();
  for (let index = 0; index < MAX_PAINT_STROKES; index++)
    state = paintReducer(state, { type: 'stroke', stroke: { ...stroke, id: `${index}` } });
  assert.equal(paintReducer(state, { type: 'stroke', stroke }), state);
  state = paintReducer(state, { type: 'clear' });
  assert.equal(state.strokes.length, 0);
  assert.equal(paintReducer(state, { type: 'undo' }).strokes.length, MAX_PAINT_STROKES);
  assert.equal(
    paintReducer(state, {
      type: 'stroke',
      stroke: { ...stroke, points: Array(MAX_STROKE_POINTS + 1).fill({ x: 0, y: 0 }) },
    }),
    state,
  );
});

test('pointer positions match across mobile and desktop sizes and clamp outside the canvas', () => {
  assert.deepEqual(paintPoint(210, 170, { left: 10, top: 20, width: 400, height: 300 }), {
    x: 400,
    y: 300,
  });
  assert.deepEqual(paintPoint(410, 320, { left: 10, top: 20, width: 800, height: 600 }), {
    x: 400,
    y: 300,
  });
  assert.deepEqual(paintPoint(-10, 1000, { left: 10, top: 20, width: 400, height: 300 }), {
    x: 0,
    y: 600,
  });
});
