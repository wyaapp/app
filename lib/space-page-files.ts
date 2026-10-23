import { z } from 'zod';
import { folderIdSchema } from './space-folders.ts';

// Page documents retain their tab identity and atomic space-content history.
export function pageDocumentName(title: string) {
  const name = title.replace(/[\\/\u0000-\u001f\u007f]/g, '-').trim() || 'Untitled';
  return /\.md$/i.test(name) ? name : `${name}.md`;
}

export type SpacePageFile = {
  id: string;
  name: string;
  title: string;
  folderId: string | null;
  pinned: boolean;
  hidden: boolean;
  version: number;
};
const reference = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  version: z.number().int().nonnegative(),
};
export const pageFileActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('move-page'), ...reference, folderId: folderIdSchema }).strict(),
  z.object({ action: z.literal('pin-page'), ...reference, pinned: z.boolean() }).strict(),
]);
export type PageFileAction = z.infer<typeof pageFileActionSchema>;
