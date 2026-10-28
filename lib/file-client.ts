import type { FileAction, SpaceFile, SpaceFileInfo } from './space-files.ts';
import type { FileOrderPatch } from './file-navigation.ts';
import type { FolderAction, SpaceFolder } from './space-folders.ts';
import type { TrashAction, TrashEntryInfo } from './space-trash.ts';

type FileRequestAction = FileAction | FolderAction | TrashAction;
export type FileResponse = {
  files?: SpaceFileInfo[];
  file?: SpaceFile;
  deleted?: string;
  folders?: SpaceFolder[];
  folder?: SpaceFolder;
  deletedFolder?: string;
  deletedIds?: string[];
  deletedFolderIds?: string[];
  restoredIds?: string[];
  trash?: TrashEntryInfo[];
  defaultFileId?: string | null;
  reorderedFiles?: FileOrderPatch[];
};

const fallback = 'Could not load or save files. Please try again.';
const unconfirmed = 'Could not confirm the save. Your changes are still in this window.';

/** Never expose HTML gateway pages or JSON parser errors as file editor messages. */
export async function requestFiles(
  url: string,
  action?: FileRequestAction,
  fetcher: typeof fetch = fetch,
): Promise<FileResponse> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: {
        Accept: 'application/json',
        ...(action ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(action ? { method: 'POST', body: JSON.stringify(action) } : { cache: 'no-store' }),
    });
  } catch {
    throw new Error('Could not reach the file service. Check your connection and try again.');
  }
  if (response.status === 401)
    throw new Error('Sign in again to continue. Keep this window open to preserve your changes.');
  if (response.status === 429)
    throw new Error('Too many file requests. Wait a moment and try again.');

  const invalid = () => new Error(action?.action === 'save' ? unconfirmed : fallback);
  if (response.redirected) throw invalid();
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw invalid();
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw invalid();
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw invalid();
  if (!response.ok) {
    const message = 'error' in result && result.error;
    throw new Error(typeof message === 'string' && message ? message : fallback);
  }
  const data = result as FileResponse;
  if (
    action &&
    ['create', 'save', 'publish', 'unpublish', 'pin', 'move', 'properties'].includes(action.action)
  ) {
    // A malformed 2xx response must not replace a draft's saved version with undefined.
    const file = data.file;
    if (
      !file ||
      typeof file.id !== 'string' ||
      typeof file.name !== 'string' ||
      typeof file.content !== 'string' ||
      !Number.isInteger(file.version) ||
      file.version < 1 ||
      ('id' in action && file.id !== action.id)
    )
      throw invalid();
  }
  return data;
}
