import { fileNavigationOrder } from './file-navigation.ts';

/** Only visitor-facing apps can be selected as a space's Main window. */
export const MAIN_WINDOW_APP_IDS = [
  'about',
  'files',
  'text-editor',
  'paint',
  'calculator',
] as const;

export type MainWindowId = (typeof MAIN_WINDOW_APP_IDS)[number] | `file-${string}`;
type MainWindowFile = { id: string; published: boolean; position?: number };
type MainWindowProfile = {
  mainWindowId?: string;
  defaultFileId?: string;
  files?: readonly MainWindowFile[];
};

export function isMainWindowId(value: unknown): value is MainWindowId {
  return (
    typeof value === 'string' &&
    (MAIN_WINDOW_APP_IDS.some((id) => id === value) ||
      /^file-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
  );
}

/** File choices are scoped to the supplied space and must already be published. */
export function normalizeMainWindowId(
  value: unknown,
  files: readonly MainWindowFile[],
): MainWindowId | undefined {
  if (!isMainWindowId(value)) return undefined;
  if (MAIN_WINDOW_APP_IDS.some((id) => id === value)) return value;
  return files.some((file) => file.published && `file-${file.id}` === value) ? value : undefined;
}

/** Deterministic on the server and client, including stale or unavailable choices. */
export function resolveMainWindowId(profile: MainWindowProfile): string {
  const files = profile.files ?? [];
  const selected = normalizeMainWindowId(profile.mainWindowId, files);
  if (selected) return selected;
  const published = fileNavigationOrder(files.filter((file) => file.published));
  const fallback = published.find((file) => file.id === profile.defaultFileId) ?? published[0];
  return fallback ? `file-${fallback.id}` : 'about';
}
