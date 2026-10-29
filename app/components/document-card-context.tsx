'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { LinkItem } from '@/lib/profile-types';
import { documentCardDomId, indexedDocumentCard } from '@/lib/document-card-links';
import { useSpacePath } from './public-address-provider';

const FileCardContext = createContext<{
  fileId: string;
  publishedLinks: readonly LinkItem[];
  domIdPrefix: string;
} | null>(null);

/** Only published index entries claim a space short URL or emit item analytics. */
export function FileCardProvider({
  fileId,
  publishedLinks = [],
  domIdPrefix = '',
  children,
}: {
  fileId: string;
  publishedLinks?: readonly LinkItem[];
  domIdPrefix?: string;
  children: ReactNode;
}) {
  return (
    <FileCardContext.Provider value={{ fileId, publishedLinks, domIdPrefix }}>
      {children}
    </FileCardContext.Provider>
  );
}

export function useFileCardId() {
  return useContext(FileCardContext)?.fileId ?? null;
}

export function useDocumentCard(handle: string) {
  const context = useContext(FileCardContext);
  const fileId = context?.fileId ?? null;
  const path = useSpacePath(handle);
  const indexed = (item: Pick<LinkItem, 'id' | 'slug'>) =>
    context ? indexedDocumentCard(context.publishedLinks, context.fileId, item) : undefined;
  return {
    fileId,
    href: (item: Pick<LinkItem, 'id' | 'slug' | 'url'>) =>
      !fileId || indexed(item) ? path(item.slug) : item.url,
    domId: (prefix: string, item: Pick<LinkItem, 'id' | 'slug'>) =>
      `${context?.domIdPrefix ?? ''}${documentCardDomId(fileId, prefix, item)}`,
    analyticsId: (item: Pick<LinkItem, 'id' | 'slug'>, preview = false) =>
      preview || (fileId && !indexed(item)) ? undefined : (item.id ?? `legacy:${item.slug}`),
  };
}
