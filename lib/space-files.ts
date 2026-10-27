import { z } from 'zod';
import { AppError } from './app-error.ts';
import { folderIdSchema } from './space-folders.ts';
import { documentAppearanceSchema, type DocumentAppearance } from './document-appearance.ts';
import { getFileFormat } from './file-formats.ts';

export const MAX_SPACE_FILES = 30;
export const MAX_FILE_BYTES = 128 * 1024;
export const fileBytes = (content: string) => new TextEncoder().encode(content).byteLength;

export const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (name) =>
      !/[\\/\u0000-\u001f\u007f]/.test(name) &&
      !name.startsWith('.') &&
      getFileFormat(name) !== null,
    'Use a .md, .txt, or .widget filename without folders.',
  );
const contentSchema = z
  .string()
  .max(MAX_FILE_BYTES)
  .refine(
    (content) => fileBytes(content) <= MAX_FILE_BYTES && !content.includes('\0'),
    'Files must be plain text, up to 128 KB.',
  );

export function decodeTextFile(name: string, bytes: ArrayBuffer) {
  if (!fileNameSchema.safeParse(name).success || bytes.byteLength > MAX_FILE_BYTES)
    throw new AppError('Choose a .md, .txt, or .widget file, up to 128 KB.');
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AppError('This file could not be read as plain text.');
  }
  if (!contentSchema.safeParse(content).success)
    throw new AppError('This file could not be read as plain text.');
  return content;
}
const versioned = { id: z.string().uuid(), version: z.number().int().positive() };
export const fileActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      name: fileNameSchema,
      content: contentSchema,
      appearance: documentAppearanceSchema.optional(),
      folderId: folderIdSchema.default(null),
    })
    .strict(),
  z
    .object({
      action: z.literal('save'),
      ...versioned,
      name: fileNameSchema,
      content: contentSchema,
      appearance: documentAppearanceSchema.optional(),
    })
    .strict(),
  z.object({ action: z.literal('publish'), ...versioned }).strict(),
  z
    .object({
      action: z.literal('properties'),
      ...versioned,
      name: fileNameSchema,
      position: z
        .number()
        .int()
        .min(0)
        .max(1000)
        .describe('Zero-based navigation position among the space files.'),
      isDefault: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal('unpublish'), ...versioned }).strict(),
  z.object({ action: z.literal('pin'), ...versioned, pinned: z.boolean() }).strict(),
  z.object({ action: z.literal('move'), ...versioned, folderId: folderIdSchema }).strict(),
  z.object({ action: z.literal('delete'), ...versioned }).strict(),
]);
export type FileAction = z.infer<typeof fileActionSchema>;
export type SpaceFileInfo = {
  id: string;
  name: string;
  folderId: string | null;
  size: number;
  version: number;
  published: boolean;
  hasChanges: boolean;
  pinned: boolean;
  updatedAt: string;
  appearance?: DocumentAppearance;
  legacyTabId?: string;
  position?: number;
};
export type SpaceFile = SpaceFileInfo & {
  content: string;
  // Owner snapshots support visitor preview without publishing pending edits.
  publishedAt?: string | null;
  publishedName?: string | null;
  publishedContent?: string | null;
  publishedAppearance?: DocumentAppearance;
};
export function fileInfo(file: SpaceFile): SpaceFileInfo {
  const {
    id,
    name,
    folderId,
    size,
    version,
    published,
    hasChanges,
    pinned,
    updatedAt,
    appearance,
    legacyTabId,
    position,
  } = file;
  return {
    id,
    name,
    folderId,
    size,
    version,
    published,
    hasChanges,
    pinned,
    updatedAt,
    appearance,
    legacyTabId,
    position,
  };
}

/** Limit Markdown links to normal web/email destinations. Embedded media is not loaded. */
export function fileLinkUrl(url: string) {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : '';
}
