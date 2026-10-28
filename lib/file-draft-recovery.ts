import { z } from 'zod';
import { fileBytes, fileNameSchema, MAX_FILE_BYTES, type SpaceFile } from './space-files.ts';
import {
  documentAppearanceSchema,
  normalizeDocumentAppearance,
  sameDocumentAppearance,
} from './document-appearance.ts';
import type { FileDraftValue } from './file-draft-session.ts';
export type { FileDraftValue } from './file-draft-session.ts';
import { normalizePageSource } from './page-documents.ts';
import { pageDraftStorageKey, restorePageDraft, samePageDraft } from './page-draft.ts';

export { pageDraftStorageKey as legacyPageDraftKey };

const draftValueSchema = z
  .object({
    name: fileNameSchema,
    content: z
      .string()
      .max(MAX_FILE_BYTES)
      .refine((value) => fileBytes(value) <= MAX_FILE_BYTES && !value.includes('\0')),
    appearance: documentAppearanceSchema,
  })
  .strict();
const draftRecordSchema = z
  .object({
    version: z.literal(1),
    fileId: z.string().min(1).max(128),
    value: draftValueSchema,
    base: draftValueSchema,
  })
  .strict();

export function fileDraftStorageKey(spaceId: string, fileId: string) {
  return `wya:file-draft:v1:${encodeURIComponent(spaceId)}:${encodeURIComponent(fileId)}`;
}

function sameFileDraft(left: FileDraftValue, right: FileDraftValue) {
  return (
    left.name === right.name &&
    left.content === right.content &&
    sameDocumentAppearance(left.appearance, right.appearance)
  );
}

/** Keep local drafts independent of publication and metadata-only version changes. */
export function serializeFileDraft(value: FileDraftValue, base: SpaceFile) {
  return JSON.stringify({
    version: 1,
    fileId: base.id,
    value: { ...value, appearance: normalizeDocumentAppearance(value.appearance) },
    base: {
      name: base.name,
      content: base.content,
      appearance: normalizeDocumentAppearance(base.appearance),
    },
  });
}

export function recoverFileDraft(raw: string | null, file: SpaceFile) {
  // Two snapshots, allowing the worst-case JSON escaping of their plain text.
  if (!raw || raw.length > MAX_FILE_BYTES * 12 + 4096) return null;
  try {
    const parsed = draftRecordSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.fileId !== file.id) return null;
    const { value, base } = parsed.data;
    const current = {
      name: file.name,
      content: file.content,
      appearance: normalizeDocumentAppearance(file.appearance),
    };
    if (sameFileDraft(value, current)) return null;
    // Preserve incomplete Markdown and widgets exactly as typed.
    return { ...value, conflict: !sameFileDraft(base, current) };
  } catch {
    return null;
  }
}

/** Local edits remain private and are never published by the migration. */
export function recoverLegacyFileDraft(raw: string | null, file: SpaceFile) {
  if (!raw || !file.legacyTabId) return null;
  let source = file.content;
  try {
    source = normalizePageSource(source);
  } catch {
    /* Preserve incomplete source. */
  }
  const current = { source, appearance: normalizeDocumentAppearance(file.appearance) };
  try {
    const recovered = restorePageDraft(JSON.parse(raw), current);
    return recovered
      ? {
          content: recovered.value.source,
          appearance: recovered.value.appearance,
          conflict: !samePageDraft(recovered.base, current),
        }
      : null;
  } catch {
    return null;
  }
}
