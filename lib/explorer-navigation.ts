import { navigateFolder, type FolderHistory } from './desktop-entries.ts';

export type ExplorerFolderRequest = { id: string; sequence: number };

/** Consume each external folder request once without overriding later user navigation. */
export function requestedFolderNavigation(
  history: FolderHistory,
  handled: string | null,
  request: ExplorerFolderRequest | undefined,
  folders: readonly { id: string }[],
  waiting: boolean,
) {
  if (!request || waiting) return null;
  const key = `${request.sequence}:${request.id}`;
  if (key === handled) return null;
  const found = folders.some((folder) => folder.id === request.id);
  return { key, found, history: found ? navigateFolder(history, request.id) : history };
}
