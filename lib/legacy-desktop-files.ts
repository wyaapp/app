import type { SpaceFileInfo } from './space-files.ts';

/** Translate only known migrated page identities before pruning saved desktop state. */
export function legacyFileAppIds(files: readonly Pick<SpaceFileInfo, 'id' | 'legacyTabId'>[]) {
  return Object.fromEntries(
    files.flatMap((file) =>
      file.legacyTabId ? [[`tab-${file.legacyTabId}`, `file-${file.id}`]] : [],
    ),
  );
}

export function remapDesktopIds(ids: readonly string[], aliases: Record<string, string>) {
  return [...new Set(ids.map((id) => aliases[id] ?? id))];
}

export function remapDesktopPositions<T>(
  positions: Record<string, T>,
  aliases: Record<string, string>,
) {
  const result = { ...positions };
  for (const [oldId, newId] of Object.entries(aliases)) {
    if (!Object.hasOwn(result, oldId)) continue;
    if (!Object.hasOwn(result, newId)) result[newId] = result[oldId];
    delete result[oldId];
  }
  return result;
}
