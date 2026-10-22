export type WindowState = { order: string[]; maximized: string[] };
export type WindowAction =
  | { type: 'open' | 'hide' | 'maximize'; id: string }
  | { type: 'clear' }
  | { type: 'reset'; firstTab: string; active: string };

/** The last visible window is frontmost. Closed windows keep their own position. */
export function initialWindows(firstTab: string, active: string): WindowState {
  return {
    order: [...new Set([firstTab, 'about', active])].filter((id) => id !== active).concat(active),
    maximized: [],
  };
}

export function windowReducer(state: WindowState, action: WindowAction): WindowState {
  switch (action.type) {
    case 'open':
      if (state.order.at(-1) === action.id) return state;
      return { ...state, order: [...state.order.filter((id) => id !== action.id), action.id] };
    case 'hide':
      return { ...state, order: state.order.filter((id) => id !== action.id) };
    case 'maximize':
      return {
        order: [...state.order.filter((id) => id !== action.id), action.id],
        maximized: state.maximized.includes(action.id)
          ? state.maximized.filter((id) => id !== action.id)
          : [...state.maximized, action.id],
      };
    case 'clear':
      return { ...state, order: [] };
    case 'reset':
      return initialWindows(action.firstTab, action.active);
  }
}

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/** Keep the whole window reachable after dragging or resizing the browser. */
export function clampWindow(point: Point, window: Size, workspace: Size): Point {
  return {
    x: Math.max(16, Math.min(point.x, workspace.width - window.width - 16)),
    y: Math.max(16, Math.min(point.y, workspace.height - window.height - 16)),
  };
}
