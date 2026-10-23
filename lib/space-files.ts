import { z } from 'zod';
import { AppError } from './app-error.ts';
import { folderIdSchema } from './space-folders.ts';

export const MAX_SPACE_FILES = 30;
export const MAX_FILE_BYTES = 64 * 1024;
export const fileBytes = (content: string) => new TextEncoder().encode(content).byteLength;

export const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (name) =>
      !/[\\/\u0000-\u001f\u007f]/.test(name) && !name.startsWith('.') && /\.(md|txt)$/i.test(name),
    'Use a .md or .txt filename without folders.',
  );
const contentSchema = z
  .string()
  .max(MAX_FILE_BYTES)
  .refine(
    (content) => fileBytes(content) <= MAX_FILE_BYTES && !content.includes('\0'),
    'Files must be plain text, up to 64 KB.',
  );

export function decodeTextFile(name: string, bytes: ArrayBuffer) {
  if (!fileNameSchema.safeParse(name).success || bytes.byteLength > MAX_FILE_BYTES)
    throw new AppError('Choose a .md or .txt file, up to 64 KB.');
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
      folderId: folderIdSchema.default(null),
    })
    .strict(),
  z
    .object({
      action: z.literal('save'),
      ...versioned,
      name: fileNameSchema,
      content: contentSchema,
    })
    .strict(),
  z.object({ action: z.literal('publish'), ...versioned }).strict(),
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
};
export type SpaceFile = SpaceFileInfo & { content: string };
export function fileInfo(file: SpaceFile): SpaceFileInfo {
  const { id, name, folderId, size, version, published, hasChanges, pinned, updatedAt } = file;
  return { id, name, folderId, size, version, published, hasChanges, pinned, updatedAt };
}

/** Limit Markdown links to normal web/email destinations. Embedded media is not loaded. */
export function fileLinkUrl(url: string) {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : '';
}
