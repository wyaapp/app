import type { SpaceFile } from './space-files.ts';

/** Share concurrent reads within a file client; never cache across spaces. */
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
