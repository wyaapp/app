/** Pins keep their place; other running apps follow in launch order. */
export function taskbarItems<T extends { id: string }>(
  entries: readonly T[],
  pinnedIds: readonly string[],
  runningIds: readonly string[],
): T[] {
  const available = new Map(entries.map((entry) => [entry.id, entry]));
  return [...new Set([...pinnedIds, ...runningIds])].flatMap((id) => {
    const entry = available.get(id);
    return entry ? [entry] : [];
  });
}
