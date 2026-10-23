import type { ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import type { LinkItem } from '@/lib/profile-types';
import type { ProfileTab } from '@/lib/profile-tabs';
import type { ProfileTheme } from '@/lib/profile-themes';
import type { ProfileFont } from '@/lib/profile-fonts';
import type { DesktopCategory } from './app-categories';

/** Public desktop sessions stay on this device. Only authenticated routes can save space content. */
export type DesktopOwnerControls = {
  visitor: boolean;
  busy: boolean;
  saveAppearance: (change: { theme?: ProfileTheme; font?: ProfileFont }) => Promise<boolean>;
  saveDesktopOrder: (order: string[]) => Promise<boolean>;
  profileEditor: ReactNode;
  apps: {
    id: string;
    title: string;
    Icon: PhosphorIcon;
    color: string;
    category: DesktopCategory;
    content: ReactNode;
    launcher?: boolean;
    shortcut?: boolean;
  }[];
  requestedApp?: { id: string; sequence: number };
  openApp: (id: string) => Promise<boolean>;
  beforeHide: (id: string, close: boolean) => Promise<boolean>;
  registerFileGuard: (guard: () => Promise<boolean>) => void;
  editItem: (item: LinkItem, tab: ProfileTab) => void;
  tabActions: (tab: ProfileTab) => ReactNode;
  menuFooter: ReactNode;
  taskbar: ReactNode;
  notification: ReactNode;
};
