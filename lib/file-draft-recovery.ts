import type { SpaceFile } from './space-files.ts';
import { normalizeDocumentAppearance } from './document-appearance.ts';
import { normalizePageSource } from './page-documents.ts';
import { pageDraftStorageKey, restorePageDraft, samePageDraft } from './page-draft.ts';

export { pageDraftStorageKey as legacyPageDraftKey };

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
