/** A schema-compatible insertion boundary and its rendered container. */
export type RichBlockDropCandidate = {
  pos: number;
  top: number;
  left: number;
  width: number;
  bounds: { left: number; right: number; top: number; bottom: number };
  depth: number;
};

type DropGeometryOptions = {
  /** Space reserved to the left of a block for its drag control. */
  gutter?: number;
  gripWidth?: number;
  /** The nearby gap before the first or after the last child remains usable. */
  edgeTolerance?: number;
};

/**
 * Pick a boundary by row, then by indentation when nested boundaries share a
 * row. Include unchanged/source boundaries: the caller must reject a no-op
 * instead of jumping to a more distant, otherwise valid destination.
 */
export function chooseRichBlockDropTarget<T extends RichBlockDropCandidate>(
  candidates: readonly T[],
  x: number,
  y: number,
  { gutter = 36, gripWidth = 28, edgeTolerance = 12 }: DropGeometryOptions = {},
): T | null {
  if (![x, y, gutter, gripWidth, edgeTolerance].every(Number.isFinite)) return null;
  const leftAllowance = Math.max(0, gutter);
  const verticalAllowance = Math.max(0, edgeTolerance);
  const gripOffset = Math.max(0, gutter - gripWidth / 2);
  const eligible = candidates.filter(({ pos, top, left, width, bounds, depth }) => {
    if (
      ![pos, top, left, width, bounds.left, bounds.right, bounds.top, bounds.bottom, depth].every(
        Number.isFinite,
      ) ||
      width <= 0 ||
      bounds.right < bounds.left ||
      bounds.bottom < bounds.top
    )
      return false;
    return (
      x >= bounds.left - leftAllowance &&
      x <= bounds.right &&
      y >= bounds.top - verticalAllowance &&
      y <= bounds.bottom + verticalAllowance
    );
  });
  if (!eligible.length) return null;

  const nearestRow = Math.min(...eligible.map(({ top }) => Math.abs(top - y)));
  // List markers and nested containers can differ by a few rendered pixels.
  // Within the same visual row, the pointer's indent determines the parent.
  const sameRow = eligible.filter(({ top }) => Math.abs(top - y) <= nearestRow + 4);
  let chosen = sameRow[0];
  let horizontalDistance = Math.abs(x - (chosen.left - gripOffset));
  for (const candidate of sameRow.slice(1)) {
    const distance = Math.abs(x - (candidate.left - gripOffset));
    if (
      distance < horizontalDistance ||
      (distance === horizontalDistance && candidate.depth > chosen.depth) ||
      (distance === horizontalDistance &&
        candidate.depth === chosen.depth &&
        Math.abs(candidate.top - y) < Math.abs(chosen.top - y))
    ) {
      chosen = candidate;
      horizontalDistance = distance;
    }
  }
  return chosen;
}
