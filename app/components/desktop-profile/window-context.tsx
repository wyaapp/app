'use client';

import { createContext, useContext, type RefObject } from 'react';

/** Transient editors share their document window's desktop and taskbar lifecycle. */
export type DesktopWindowHost = {
  id: string;
  title: string;
  node: RefObject<HTMLElement | null>;
  workspace: RefObject<HTMLDivElement | null>;
  open: boolean;
  active: boolean;
  layer: number;
  onFocus: () => void;
};

export const DesktopWindowContext = createContext<DesktopWindowHost | null>(null);

export function useDesktopWindow() {
  return useContext(DesktopWindowContext);
}
