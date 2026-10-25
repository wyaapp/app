'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { LinkItem } from '@/lib/profile-types';
import { useSpacePath } from './public-address-provider';

const FileCardContext = createContext<string | null>(null);

/** Files own their cards locally; they do not claim the profile's short URLs. */
export function FileCardProvider({ fileId, children }: { fileId: string; children: ReactNode }) {
  return <FileCardContext.Provider value={fileId}>{children}</FileCardContext.Provider>;
}

export function useFileCardId() {
  return useContext(FileCardContext);
}

export function useDocumentCard(handle: string) {
  const fileId = useFileCardId();
  const path = useSpacePath(handle);
  return {
    fileId,
    href: (item: Pick<LinkItem, 'slug' | 'url'>) => (fileId ? item.url : path(item.slug)),
    domId: (prefix: string, item: Pick<LinkItem, 'id' | 'slug'>) =>
      `${fileId ? `file-${fileId}-` : ''}${prefix}-${item.id ?? item.slug}`,
    analyticsId: (item: Pick<LinkItem, 'id' | 'slug'>, preview = false) =>
      fileId || preview ? undefined : (item.id ?? `legacy:${item.slug}`),
  };
}
