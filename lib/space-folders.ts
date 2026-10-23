import { z } from 'zod';

export const MAX_SPACE_FOLDERS = 30;
export const MAX_FOLDER_DEPTH = 5;
export const folderIdSchema = z.string().uuid().nullable();
export const folderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (name) => !/[\\/\u0000-\u001f\u007f]/.test(name) && !name.startsWith('.'),
    'Use a folder name without slashes or a leading dot.',
  );
const versioned = { id: z.string().uuid(), version: z.number().int().positive() };
export const folderActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create-folder'),
      name: folderNameSchema,
      parentId: folderIdSchema.default(null),
    })
    .strict(),
  z.object({ action: z.literal('rename-folder'), ...versioned, name: folderNameSchema }).strict(),
  z.object({ action: z.literal('move-folder'), ...versioned, parentId: folderIdSchema }).strict(),
  z.object({ action: z.literal('delete-folder'), ...versioned }).strict(),
]);
export type FolderAction = z.infer<typeof folderActionSchema>;
export type SpaceFolder = {
  id: string;
  name: string;
  parentId: string | null;
  version: number;
  system?: 'desktop';
};

export const desktopFolder = (folders: SpaceFolder[]) =>
  folders.find((folder) => folder.system === 'desktop');
export const folderDepth = (folders: SpaceFolder[], id: string | null) =>
  folderTrail(folders, id).filter((folder) => !folder.system).length;

export function canMoveFolder(folders: SpaceFolder[], id: string, parentId: string | null) {
  const folder = folders.find((folder) => folder.id === id);
  if (
    !folder ||
    folder.system ||
    folder.parentId === parentId ||
    (parentId && !folders.some((f) => f.id === parentId))
  )
    return false;
  const parents = folderTrail(folders, parentId);
  if (parents.some((folder) => folder.id === id)) return false;
  const height = Math.max(
    1,
    ...folders.map((child) => {
      const path = folderTrail(folders, child.id);
      const index = path.findIndex((folder) => folder.id === id);
      return index < 0 ? 0 : path.length - index;
    }),
  );
  return parents.filter((folder) => !folder.system).length + height <= MAX_FOLDER_DEPTH;
}

export function folderTrail(folders: SpaceFolder[], id: string | null) {
  const trail: SpaceFolder[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find((folder) => folder.id === id);
    if (!folder) break;
    trail.unshift(folder);
    id = folder.parentId;
  }
  return trail;
}

/** Desktop is always present; other folders need public descendants. */
export function publicFolders(folders: SpaceFolder[], files: { folderId: string | null }[]) {
  const visible = new Set(
    files.flatMap((file) => folderTrail(folders, file.folderId).map((folder) => folder.id)),
  );
  return folders
    .filter((folder) => folder.system === 'desktop' || visible.has(folder.id))
    .map((folder) => ({ ...folder, version: 0 }));
}
