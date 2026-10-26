export type IconPoint = { x: number; y: number };
export type IconPositions = Record<string, IconPoint>;
export type DesktopSize = { width: number; height: number };

// Shared by the layout calculation and shortcut CSS variables.
export const DESKTOP_ICON = {
  width: 80,
  height: 80,
  gap: 8,
  left: 20,
  top: 28,
  edge: 8,
  dot: 22,
  padding: 6,
  bottom: 60,
};

export function readIconPositions(value: string | null): IconPositions {
  if (!value || value.length > 64 * 1024) return {};
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(
      Object.entries(data)
        .filter(
          ([id, point]) =>
            /^[a-zA-Z0-9_-]{1,128}$/.test(id) &&
            point &&
            typeof point === 'object' &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y) &&
            point.x >= 0 &&
            point.y >= 0 &&
            point.x <= 100_000 &&
            point.y <= 100_000,
        )
        .slice(0, 500)
        .map(([id, point]) => [id, { x: Math.round(point.x), y: Math.round(point.y) }]),
    );
  } catch {
    return {};
  }
}

export function readDesktopGridPositions(value: string | null): IconPositions {
  if (!value || value.length > 64 * 1024) return {};
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    if ('version' in data) {
      if (data.version !== 2 || !('positions' in data)) return {};
      return readIconPositions(JSON.stringify(data.positions));
    }
    // Earlier grid layouts used an 84px horizontal pitch. Preserve each
    // saved column when moving to square slots, including distant columns.
    const { left, width, gap } = DESKTOP_ICON;
    return Object.fromEntries(
      Object.entries(readIconPositions(value)).map(([id, point]) => [
        id,
        { x: left + Math.round((point.x - left) / 84) * (width + gap), y: point.y },
      ]),
    );
  } catch {
    return {};
  }
}

export function serializeDesktopGridPositions(positions: IconPositions): string {
  return JSON.stringify({ version: 2, positions });
}

export function clampIconPoint(point: IconPoint, size: DesktopSize): IconPoint {
  const { width, height, edge } = DESKTOP_ICON;
  return {
    x: Math.round(Math.max(edge, Math.min(point.x, size.width - width - edge))),
    y: Math.round(Math.max(edge, Math.min(point.y, size.height - height - edge))),
  };
}

export function desktopIconPositions(
  ids: readonly string[],
  saved: IconPositions,
  size: DesktopSize,
): IconPositions {
  const { width, height, gap, left, top, bottom } = DESKTOP_ICON;
  const rows = Math.max(1, Math.floor((size.height - top - bottom + gap) / (height + gap)));
  const result: IconPositions = Object.fromEntries(
    ids.filter((id) => Object.hasOwn(saved, id)).map((id) => [id, clampIconPoint(saved[id], size)]),
  );
  let slot = 0;
  for (const id of ids) {
    if (Object.hasOwn(result, id)) continue;
    let point: IconPoint;
    do {
      point = {
        x: left + Math.floor(slot / rows) * (width + gap),
        y: top + (slot % rows) * (height + gap),
      };
      slot++;
    } while (
      Object.values(result).some(
        (other) =>
          Math.abs(other.x - point.x) < width + gap && Math.abs(other.y - point.y) < height + gap,
      )
    );
    result[id] = point;
  }
  return result;
}

export function desktopIconDrop(
  pointer: IconPoint,
  grab: IconPoint,
  bounds: DesktopSize & { left: number; top: number },
): IconPoint {
  return clampIconPoint(
    { x: pointer.x - bounds.left - grab.x, y: pointer.y - bounds.top - grab.y },
    bounds,
  );
}

type IconSlot = { column: number; row: number };
type IconGrid = { columns: number; rows: number; origin: IconPoint };

function desktopIconGrid(size: DesktopSize): IconGrid {
  const { width, height, gap, left, top, edge, bottom } = DESKTOP_ICON;
  return {
    columns: Math.max(1, Math.floor((size.width - left - edge + gap) / (width + gap))),
    // Keep the same bottom reserve and column order as the automatic layout.
    rows: Math.max(1, Math.floor((size.height - top - bottom + gap) / (height + gap))),
    origin: clampIconPoint({ x: left, y: top }, size),
  };
}

function iconSlot(point: IconPoint, grid: IconGrid): IconSlot {
  return {
    column: Math.round((point.x - grid.origin.x) / (DESKTOP_ICON.width + DESKTOP_ICON.gap)),
    row: Math.round((point.y - grid.origin.y) / (DESKTOP_ICON.height + DESKTOP_ICON.gap)),
  };
}

function iconSlotPoint(slot: IconSlot, grid: IconGrid): IconPoint {
  return {
    x: grid.origin.x + slot.column * (DESKTOP_ICON.width + DESKTOP_ICON.gap),
    y: grid.origin.y + slot.row * (DESKTOP_ICON.height + DESKTOP_ICON.gap),
  };
}

function iconSlotKey(slot: IconSlot): string {
  return `${slot.column}:${slot.row}`;
}

function visibleIconSlot(slot: IconSlot, grid: IconGrid): IconSlot {
  return {
    column: Math.max(0, Math.min(slot.column, grid.columns - 1)),
    row: Math.max(0, Math.min(slot.row, grid.rows - 1)),
  };
}

export function snapDesktopIconPoint(point: IconPoint, size: DesktopSize): IconPoint {
  const grid = desktopIconGrid(size);
  return iconSlotPoint(visibleIconSlot(iconSlot(point, grid), grid), grid);
}

function vacantIconSlot(
  grid: IconGrid,
  occupied: ReadonlySet<string>,
  preferred?: IconSlot,
): IconSlot {
  let nearest: IconSlot | undefined;
  let distance = Infinity;
  for (let column = 0; column < grid.columns; column++) {
    for (let row = 0; row < grid.rows; row++) {
      const candidate = { column, row };
      if (occupied.has(iconSlotKey(candidate))) continue;
      if (!preferred) return candidate;
      const dx = (column - preferred.column) * (DESKTOP_ICON.width + DESKTOP_ICON.gap);
      const dy = (row - preferred.row) * (DESKTOP_ICON.height + DESKTOP_ICON.gap);
      const nextDistance = dx * dx + dy * dy;
      if (nextDistance < distance) {
        distance = nextDistance;
        nearest = candidate;
      }
    }
  }
  if (nearest) return nearest;

  // A full desktop continues in scrollable columns instead of stacking icons.
  for (let column = grid.columns; ; column++) {
    for (let row = 0; row < grid.rows; row++) {
      const candidate = { column, row };
      if (!occupied.has(iconSlotKey(candidate))) return candidate;
    }
  }
}

export function desktopGridPositions(
  ids: readonly string[],
  saved: IconPositions,
  size: DesktopSize,
): IconPositions {
  const grid = desktopIconGrid(size);
  const currentIds = [...new Set(ids)];
  // Overflow columns belong to the grid too. Reserve them before placing any
  // saved icons, so a deliberate empty slot in the viewport stays empty.
  grid.columns = Math.max(grid.columns, Math.ceil(currentIds.length / grid.rows));
  const occupied = new Set<string>();
  const slots = new Map<string, IconSlot>();
  const pending: { id: string; preferred: IconSlot }[] = [];

  // Reserve saved slots that still fit first, so a resize never lets an icon
  // clamped from outside the grid displace an icon that already fits.
  for (const id of currentIds) {
    if (!Object.hasOwn(saved, id)) continue;
    const slot = iconSlot(saved[id], grid);
    const visible = visibleIconSlot(slot, grid);
    const key = iconSlotKey(slot);
    if (slot.column === visible.column && slot.row === visible.row && !occupied.has(key)) {
      slots.set(id, slot);
      occupied.add(key);
    } else {
      pending.push({ id, preferred: visible });
    }
  }

  // These are derived positions only. The caller retains the saved originals
  // so expanding the viewport restores icons to their original grid slots.
  for (const { id, preferred } of pending) {
    const slot = vacantIconSlot(grid, occupied, preferred);
    slots.set(id, slot);
    occupied.add(iconSlotKey(slot));
  }
  for (const id of currentIds) {
    if (slots.has(id)) continue;
    const slot = vacantIconSlot(grid, occupied);
    slots.set(id, slot);
    occupied.add(iconSlotKey(slot));
  }

  return Object.fromEntries(currentIds.map((id) => [id, iconSlotPoint(slots.get(id)!, grid)]));
}

export function moveDesktopGridIcon(
  ids: readonly string[],
  current: IconPositions,
  id: string,
  point: IconPoint,
  size: DesktopSize,
): IconPositions {
  const positions = desktopGridPositions(ids, current, size);
  const target = snapDesktopIconPoint(point, size);
  const original = positions[id];
  const occupant = Object.keys(positions).find(
    (other) => other !== id && positions[other].x === target.x && positions[other].y === target.y,
  );
  positions[id] = target;
  if (occupant) {
    if (original) {
      positions[occupant] = original;
    } else {
      // An incoming file has no old slot. Move only its target's occupant to
      // the nearest vacancy instead of rearranging all the other shortcuts.
      const grid = desktopIconGrid(size);
      const occupied = new Set(
        Object.entries(positions)
          .filter(([other]) => other !== occupant)
          .map(([, position]) => iconSlotKey(iconSlot(position, grid))),
      );
      positions[occupant] = iconSlotPoint(
        vacantIconSlot(grid, occupied, iconSlot(target, grid)),
        grid,
      );
    }
  }
  return positions;
}
