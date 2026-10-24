import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseRichBlockDropTarget,
  type RichBlockDropCandidate,
} from '../lib/rich-document-drop.ts';

function boundary(
  pos: number,
  top: number,
  overrides: Partial<RichBlockDropCandidate> = {},
): RichBlockDropCandidate {
  return {
    pos,
    top,
    left: 124,
    width: 476,
    bounds: { left: 100, right: 600, top: 100, bottom: 172 },
    depth: 1,
    ...overrides,
  };
}

test('list rows remain droppable through the same gutter used by the drag grip', () => {
  const second = boundary(10, 124);
  // A 36px gutter extends beyond the list container's 24px indentation.
  assert.equal(chooseRichBlockDropTarget([second], 90, 124), second);
  assert.equal(chooseRichBlockDropTarget([second], 64, 124), second);
  assert.equal(chooseRichBlockDropTarget([second], 63, 124), null);
});

test('before-first and after-last boundaries accept a small gap outside the list', () => {
  const first = boundary(1, 100);
  const last = boundary(30, 172);
  const candidates = [first, boundary(10, 124), boundary(20, 148), last];
  assert.equal(chooseRichBlockDropTarget(candidates, 102, 88), first);
  assert.equal(chooseRichBlockDropTarget(candidates, 102, 184), last);
  assert.equal(chooseRichBlockDropTarget(candidates, 102, 87), null);
  assert.equal(chooseRichBlockDropTarget(candidates, 102, 185), null);
});

test('moving between separate lists selects the destination boundary nearest the pointer', () => {
  const source = boundary(10, 124);
  const destinationFirst = boundary(50, 230, {
    bounds: { left: 100, right: 600, top: 230, bottom: 278 },
  });
  const destinationLast = { ...destinationFirst, pos: 80, top: 278 };
  const candidates = [source, destinationFirst, destinationLast];
  assert.equal(chooseRichBlockDropTarget(candidates, 92, 224), destinationFirst);
  assert.equal(chooseRichBlockDropTarget(candidates, 92, 283), destinationLast);
});

test('a shared outer and nested boundary follows the horizontal drag position', () => {
  const outer = boundary(40, 172);
  const nested = boundary(38, 172, {
    left: 148,
    width: 452,
    bounds: { left: 124, right: 600, top: 124, bottom: 172 },
    depth: 3,
  });
  // Grip centers: outer 102px, nested 126px. Moving left outdents the target.
  assert.equal(chooseRichBlockDropTarget([nested, outer], 102, 172), outer);
  assert.equal(chooseRichBlockDropTarget([outer, nested], 126, 172), nested);
  assert.equal(chooseRichBlockDropTarget([outer, nested], 400, 172), nested);
});

test('small vertical differences at a nested edge do not defeat indentation intent', () => {
  const outer = boundary(40, 172);
  const nested = boundary(38, 170, {
    left: 148,
    depth: 3,
    bounds: { left: 124, right: 600, top: 124, bottom: 170 },
  });
  assert.equal(chooseRichBlockDropTarget([outer, nested], 102, 170), outer);
  assert.equal(chooseRichBlockDropTarget([outer, nested], 126, 172), nested);
});

test('distinct rows prioritize vertical proximity over a more convenient indent', () => {
  const nearest = boundary(10, 124, { left: 148, depth: 3 });
  const nextRow = boundary(20, 148);
  assert.equal(chooseRichBlockDropTarget([nextRow, nearest], 102, 126), nearest);
});

test('overlapping nested containers do not attract drops outside their vertical region', () => {
  const outer = boundary(40, 172);
  const nested = boundary(10, 124, {
    left: 148,
    depth: 3,
    bounds: { left: 124, right: 600, top: 100, bottom: 124 },
  });
  assert.equal(chooseRichBlockDropTarget([nested, outer], 126, 172), outer);
});

test('unchanged source boundaries stay eligible instead of causing a distant reorder', () => {
  const unchanged = { ...boundary(10, 124), unchanged: true };
  const distant = { ...boundary(30, 172), unchanged: false };
  assert.equal(chooseRichBlockDropTarget([distant, unchanged], 102, 124), unchanged);
});

test('custom gutter and grip dimensions preserve the same indentation choice', () => {
  const outer = boundary(40, 172);
  const nested = boundary(38, 172, { left: 148, depth: 3 });
  const options = { gutter: 48, gripWidth: 40, edgeTolerance: 6 };
  assert.equal(chooseRichBlockDropTarget([outer, nested], 96, 172, options), outer);
  assert.equal(chooseRichBlockDropTarget([outer, nested], 120, 172, options), nested);
  assert.equal(chooseRichBlockDropTarget([outer], 96, 179, options), null);
});

test('ties prefer the deeper semantic container and never reorder the input candidates', () => {
  const outer = boundary(40, 172);
  const nested = boundary(38, 172, { depth: 3 });
  const candidates = Object.freeze([outer, nested]);
  assert.equal(chooseRichBlockDropTarget(candidates, 102, 172), nested);
  assert.deepEqual(candidates, [outer, nested]);
});

test('invalid geometry and positions outside the available area produce no target', () => {
  const valid = boundary(10, 124);
  assert.equal(chooseRichBlockDropTarget([], 102, 124), null);
  assert.equal(chooseRichBlockDropTarget([valid], NaN, 124), null);
  assert.equal(chooseRichBlockDropTarget([valid], 102, Infinity), null);
  assert.equal(chooseRichBlockDropTarget([valid], 601, 124), null);
  assert.equal(chooseRichBlockDropTarget([{ ...valid, width: 0 }], 102, 124), null);
  assert.equal(chooseRichBlockDropTarget([{ ...valid, top: NaN }], 102, 124), null);
  assert.equal(
    chooseRichBlockDropTarget([{ ...valid, bounds: { ...valid.bounds, bottom: 50 } }], 102, 124),
    null,
  );
});
