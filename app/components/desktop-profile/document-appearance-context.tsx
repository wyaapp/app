'use client';

import { createContext, useContext, useLayoutEffect, useMemo } from 'react';
import type { DocumentAppearance } from '@/lib/document-appearance';

/** A document owns its live appearance; the surrounding OS window mirrors its palette. */
export const DocumentAppearanceContext = createContext<
  ((appearance: DocumentAppearance | null) => void) | null
>(null);

export function useWindowDocumentAppearance(appearance: DocumentAppearance) {
  const update = useContext(DocumentAppearanceContext);
  const { theme, accent, headingFont, bodyFont } = appearance;
  const value = useMemo(
    () => ({ theme, accent, headingFont, bodyFont }),
    [theme, accent, headingFont, bodyFont],
  );
  useLayoutEffect(() => {
    update?.(value);
    return () => update?.(null);
  }, [update, value]);
}
