import type { SpaceFile, SpaceFileInfo } from './space-files.ts';

/** Reuse SSR documents only when the fresh directory still describes that snapshot. */
export function currentBootstrapDocuments(
  documents: readonly SpaceFile[],
  files: readonly SpaceFileInfo[],
) {
  const metadata = new Map(files.map((file) => [file.id, file]));
  return documents.flatMap((document) => {
    const file = metadata.get(document.id);
    if (
      !file ||
      file.version !== document.version ||
      file.updatedAt !== document.updatedAt ||
      file.name !== document.name ||
      file.size !== document.size ||
      JSON.stringify(file.appearance ?? {}) !== JSON.stringify(document.appearance ?? {})
    )
      return [];
    return [{ ...document, ...file }];
  });
}

/** Share concurrent reads within a desktop; never cache across owner/public endpoints. */
export function coalesceFileReads(load: (url: string) => Promise<SpaceFile>) {
  const pending = new Map<string, Promise<SpaceFile>>();
  return (endpoint: string, id: string): Promise<SpaceFile> => {
    const url = `${endpoint}&id=${encodeURIComponent(id)}`;
    const existing = pending.get(url);
    if (existing) return existing;
    const request = load(url).finally(() => pending.delete(url));
    pending.set(url, request);
    return request;
  };
}
