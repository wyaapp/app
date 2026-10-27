/** Stable navigation order shared by file properties and default-file selection. */
export function fileNavigationOrder<T extends { id: string; position?: number }>(
  files: readonly T[],
): T[] {
  return [...files].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id),
  );
}

export type FileOrderPatch = {
  id: string;
  previousVersion: number;
  version: number;
  position: number;
  updatedAt: string;
};

/** Order-only writes can advance the version without replacing an open file's source. */
export function applyFileOrderPatch<T extends { id: string; version: number }>(
  file: T,
  patches: readonly FileOrderPatch[],
): T {
  const patch = patches.find(
    (item) => item.id === file.id && item.previousVersion === file.version,
  );
  return patch
    ? { ...file, version: patch.version, position: patch.position, updatedAt: patch.updatedAt }
    : file;
}
