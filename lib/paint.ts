export const PAINT_WIDTH = 800;
export const PAINT_HEIGHT = 600;
export const MAX_PAINT_STROKES = 200;
export const MAX_STROKE_POINTS = 2048;
const MAX_UNDO = 40;

export type PaintPoint = { x: number; y: number };
export type PaintStroke = {
  id: string;
  tool: 'pencil' | 'eraser';
  color: string;
  size: number;
  points: PaintPoint[];
};
export type PaintState = {
  strokes: PaintStroke[];
  past: PaintStroke[][];
  future: PaintStroke[][];
};
export type PaintAction =
  { type: 'stroke'; stroke: PaintStroke } | { type: 'undo' | 'redo' | 'clear' };

export function emptyPaint(): PaintState {
  return { strokes: [], past: [], future: [] };
}

/** Immutable strokes keep history small and can later be sent as drawing operations. */
export function paintReducer(state: PaintState, action: PaintAction): PaintState {
  if (action.type === 'undo') {
    const strokes = state.past.at(-1);
    return strokes
      ? { strokes, past: state.past.slice(0, -1), future: [state.strokes, ...state.future] }
      : state;
  }
  if (action.type === 'redo') {
    const strokes = state.future[0];
    return strokes
      ? {
          strokes,
          past: [...state.past, state.strokes].slice(-MAX_UNDO),
          future: state.future.slice(1),
        }
      : state;
  }
  if (action.type === 'clear' && !state.strokes.length) return state;
  if (
    action.type === 'stroke' &&
    (state.strokes.length >= MAX_PAINT_STROKES ||
      !action.stroke.points.length ||
      action.stroke.points.length > MAX_STROKE_POINTS)
  )
    return state;
  return {
    strokes: action.type === 'stroke' ? [...state.strokes, action.stroke] : [],
    past: [...state.past, state.strokes].slice(-MAX_UNDO),
    future: [],
  };
}

/** Mouse, pen and touch all map to the same logical canvas, independent of window size. */
export function paintPoint(
  x: number,
  y: number,
  bounds: { left: number; top: number; width: number; height: number },
): PaintPoint {
  return {
    x:
      Math.round(
        Math.max(0, Math.min(PAINT_WIDTH, ((x - bounds.left) / bounds.width) * PAINT_WIDTH)) * 10,
      ) / 10,
    y:
      Math.round(
        Math.max(0, Math.min(PAINT_HEIGHT, ((y - bounds.top) / bounds.height) * PAINT_HEIGHT)) * 10,
      ) / 10,
  };
}
