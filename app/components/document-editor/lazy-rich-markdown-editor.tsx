'use client';

import { lazy, Suspense, useSyncExternalStore, type ComponentProps } from 'react';
import type { RichMarkdownEditor as RichEditor } from './rich-markdown-editor';
import { useTranslation } from '../language-provider';

const RichMarkdownEditor = lazy(() =>
  import('./rich-markdown-editor').then((module) => ({ default: module.RichMarkdownEditor })),
);
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Tiptap needs the browser. Do not load its module or build editor state during SSR. */
export function LazyRichMarkdownEditor(props: ComponentProps<typeof RichEditor>) {
  const { t } = useTranslation();
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const placeholder = <p className="rich-editor-loading">{t('Loading…')}</p>;
  if (!mounted) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      <RichMarkdownEditor {...props} />
    </Suspense>
  );
}
