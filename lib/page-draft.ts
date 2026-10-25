import { MAX_PAGE_DOCUMENT_BYTES, normalizePageSource } from './page-documents.ts';
import {
  normalizeDocumentAppearance,
  sameDocumentAppearance,
  type DocumentAppearance,
} from './document-appearance.ts';

export type PageDraftValue = { source: string; appearance: DocumentAppearance };
export type PageDraft = { value: PageDraftValue; base: PageDraftValue };

export function samePageDraft(left: PageDraftValue, right: PageDraftValue) {
  return left.source === right.source && sameDocumentAppearance(left.appearance, right.appearance);
}

function readableSource(source: string) {
  try {
    return normalizePageSource(source);
  } catch {
    // Incomplete Code edits must remain recoverable.
    return source;
  }
}

/** Old source-only drafts inherit the appearance they were opened with. */
export function restorePageDraft(raw: unknown, published: PageDraftValue): PageDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (
    (record.version !== 1 && record.version !== 2) ||
    typeof record.source !== 'string' ||
    record.source.length > MAX_PAGE_DOCUMENT_BYTES ||
    typeof record.baseSource !== 'string' ||
    record.baseSource.length > MAX_PAGE_DOCUMENT_BYTES
  )
    return null;
  const appearance = (key: string) =>
    record.version === 1 ? published.appearance : normalizeDocumentAppearance(record[key]);
  const value = { source: readableSource(record.source), appearance: appearance('appearance') };
  if (samePageDraft(value, published)) return null;
  return {
    value,
    base: { source: readableSource(record.baseSource), appearance: appearance('baseAppearance') },
  };
}

export function serializePageDraft(draft: PageDraft) {
  return JSON.stringify({
    version: 2,
    source: draft.value.source,
    appearance: draft.value.appearance,
    baseSource: draft.base.source,
    baseAppearance: draft.base.appearance,
  });
}
