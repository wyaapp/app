import { fileNavigationOrder } from './file-navigation.ts';
import { publicProfileFiles } from './profile-files.ts';
import type { SpaceFile, SpaceFileInfo } from './space-files.ts';

/** An omitted layout follows published navigation; an empty list intentionally shows no files. */
export type MobileLayout = { fileIds: string[]; screens?: 'mobile' | 'all' };

type MobileLayoutProfile = {
  mobileLayout?: MobileLayout;
  mainWindowId?: string;
  defaultFileId?: string;
  files?: readonly SpaceFile[];
};

/** Keep an explicit layout explicit when a selected file is unpublished or removed. */
export function normalizeMobileLayout(
  value: unknown,
  files: readonly { id: string; published: boolean }[],
): MobileLayout | undefined {
  if (!value || typeof value !== 'object' || !('fileIds' in value)) return undefined;
  if (!Array.isArray(value.fileIds)) return undefined;
  const available = new Set(files.filter((file) => file.published).map((file) => file.id));
  return {
    ...('screens' in value && value.screens === 'all' ? { screens: 'all' as const } : {}),
    fileIds: [
      ...new Set(
        value.fileIds.filter((id): id is string => typeof id === 'string' && available.has(id)),
      ),
    ],
  };
}

/** Resolve published snapshots only, including when the owner has newer private edits. */
export function resolveMobileFiles(profile: MobileLayoutProfile): SpaceFile[] {
  const files = publicProfileFiles(profile.files ?? []);
  return orderColumnFiles(profile, files);
}

/** Order already-authorized snapshots or metadata without parsing document content again. */
export function orderColumnFiles<T extends SpaceFileInfo>(
  profile: Omit<MobileLayoutProfile, 'files'>,
  files: readonly T[],
): T[] {
  const layout = normalizeMobileLayout(profile.mobileLayout, files);
  if (layout) {
    const byId = new Map(files.map((file) => [file.id, file]));
    return layout.fileIds.map((id) => byId.get(id)!);
  }
  const ordered = fileNavigationOrder(files);
  const first =
    ordered.find((file) => `file-${file.id}` === profile.mainWindowId) ??
    ordered.find((file) => file.id === profile.defaultFileId);
  return first ? [first, ...ordered.filter((file) => file.id !== first.id)] : ordered;
}
