'use client';

import { useRef, useState } from 'react';
import type { LinkItem } from '@/lib/model';
import { copyItem, copySection, CLIPBOARD_LIMIT } from '@/lib/content-clipboard';
import { applyProfileLayout, reconcileProfileLayout } from '@/lib/profile-tabs';
import type { WorkspaceController } from './use-workspace';

type ClipboardDialog = {
  mode: 'copy' | 'paste';
  text: string;
  sectionId?: string;
  error?: string;
};

export function useContentClipboard(workspace: WorkspaceController) {
  const [dialog, setDialog] = useState<ClipboardDialog | null>(null);
  const [reading, setReading] = useState(false);
  const sequence = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  function rememberFocus() {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  function close() {
    sequence.current++;
    setDialog(null);
    setReading(false);
  }
  async function copy(source: LinkItem | string) {
    rememberFocus();
    try {
      if (!(await workspace.finishEntry())) return false;
      const current = workspace.latestProfile.current;
      if (!current) return false;
      // Autosave may have renamed a URL while we were waiting. Keep the draft's
      // positions by matching stable item IDs before reconciling its layout.
      const names = new Map(
        workspace.profile?.links.flatMap((previous) => {
          const saved = previous.id && current.links.find((item) => item.id === previous.id);
          return saved ? [[previous.slug, saved.slug] as const] : [];
        }),
      );
      const draft = {
        ...workspace.profileLayout,
        tabs: workspace.profileLayout.tabs.map((tab) => ({
          ...tab,
          ungrouped: tab.ungrouped.map((slug) => names.get(slug) ?? slug),
          sections: tab.sections.map((section) => ({
            ...section,
            slugs: section.slugs.map((slug) => names.get(slug) ?? slug),
          })),
        })),
      };
      const data = applyProfileLayout(current, reconcileProfileLayout(draft, current));
      const item =
        typeof source === 'string'
          ? undefined
          : data.links.find((item) =>
              source.id ? item.id === source.id : item.slug === source.slug,
            );
      const content =
        typeof source === 'string'
          ? copySection(data, source)
          : copyItem(data, item?.slug ?? source.slug);
      const text = JSON.stringify(content);
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        setDialog({ mode: 'copy', text });
      }
    } catch (error) {
      setDialog({
        mode: 'copy',
        text: '',
        error: error instanceof Error ? error.message : 'Could not copy content.',
      });
    }
    return false;
  }
  async function openPaste(sectionId?: string) {
    rememberFocus();
    const request = ++sequence.current;
    setDialog({ mode: 'paste', text: '', sectionId });
    setReading(true);
    workspace.setError('');
    try {
      const text = await navigator.clipboard.readText();
      if (request !== sequence.current) return;
      setDialog({
        mode: 'paste',
        sectionId,
        text: text.length <= CLIPBOARD_LIMIT ? text : '',
        ...(text.length > CLIPBOARD_LIMIT ? { error: 'Copied content must be under 1 MB.' } : {}),
      });
    } catch {
      // Browsers can deny clipboard access. The dialog accepts a normal paste too.
    } finally {
      if (request === sequence.current) setReading(false);
    }
  }
  function changeText(text: string) {
    // A delayed clipboard permission response must not overwrite a manual paste.
    sequence.current++;
    setReading(false);
    setDialog((current) => current && { ...current, text, error: undefined });
  }
  return { dialog, reading, copy, openPaste, close, changeText, returnFocus };
}
export type ContentClipboard = ReturnType<typeof useContentClipboard>;
