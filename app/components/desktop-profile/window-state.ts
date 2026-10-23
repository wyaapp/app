export type WindowState = {
  loaded: string[];
  running: string[];
  order: string[];
  maximized: string[];
};
export type WindowAction =
  | { type: 'open' | 'hide' | 'close' | 'maximize'; id: string }
  | { type: 'restore'; state: WindowState }
  | { type: 'clear' }
  | { type: 'reset'; firstTab: string; active: string; preserve?: string[] };

/** Both visitors and owners use the same window lifecycle. */
export function initialWindows(firstTab: string, active: string): WindowState {
  const order = [...new Set([firstTab, 'about', active])]
    .filter((id) => id !== active)
    .concat(active);
  return { loaded: order, running: order, order, maximized: [] };
}

export function windowReducer(state: WindowState, action: WindowAction): WindowState {
  if (action.type === 'restore') return action.state;
  if (action.type === 'reset') {
    const initial = initialWindows(action.firstTab, action.active);
    return {
      ...initial,
      loaded: [
        ...new Set([
          ...initial.loaded,
          ...state.loaded.filter((id) => action.preserve?.includes(id)),
        ]),
      ],
    };
  }
  if (action.type === 'clear') return { ...state, order: [] };
  const { id } = action;
  if (action.type === 'hide' || action.type === 'close')
    return {
      ...state,
      order: state.order.filter((app) => app !== id),
      running: action.type === 'close' ? state.running.filter((app) => app !== id) : state.running,
    };
  if (action.type === 'open' && state.order.at(-1) === id) return state;
  return {
    loaded: state.loaded.includes(id) ? state.loaded : [...state.loaded, id],
    running: state.running.includes(id) ? state.running : [...state.running, id],
    order: [...state.order.filter((app) => app !== id), id],
    maximized:
      action.type !== 'maximize'
        ? state.maximized
        : state.maximized.includes(id)
          ? state.maximized.filter((app) => app !== id)
          : [...state.maximized, id],
  };
}

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/** Allow off-screen content while keeping enough of the title bar reachable to drag it back. */
export function clampWindow(point: Point, window: Size, workspace: Size): Point {
  // Leave room for both the window controls and part of the drag handle at the left edge.
  const visibleWidth = Math.min(180, window.width, workspace.width);
  const visibleHeight = Math.min(48, window.height, workspace.height);
  return {
    x: Math.max(visibleWidth - window.width, Math.min(point.x, workspace.width - visibleWidth)),
    y: Math.max(0, Math.min(point.y, workspace.height - visibleHeight)),
  };
}
