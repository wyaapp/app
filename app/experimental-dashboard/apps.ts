import { ChartBarIcon } from '@phosphor-icons/react/dist/ssr/ChartBar';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { GlobeIcon } from '@phosphor-icons/react/dist/ssr/Globe';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ClockCounterClockwise';
import { BookOpenIcon } from '@phosphor-icons/react/dist/ssr/BookOpen';
import { UserIcon } from '@phosphor-icons/react/dist/ssr/User';
import type { DashboardSection } from '@/lib/dashboard-routes';
import type { DesktopCategory } from '../components/desktop-profile/app-categories';

export type DesktopApp = DashboardSection;
export const desktopApps = [
  {
    id: 'links',
    label: 'My content',
    icon: FolderOpenIcon,
    color: 'yellow',
    category: 'apps',
    shortcut: true,
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: UserIcon,
    color: 'lilac',
    category: 'content',
    shortcut: false,
  },
  {
    id: 'metrics',
    label: 'Analytics',
    icon: ChartBarIcon,
    color: 'lime',
    category: 'apps',
    shortcut: true,
  },
  {
    id: 'domains',
    label: 'Custom domain',
    icon: GlobeIcon,
    color: 'sky',
    category: 'settings',
    shortcut: false,
  },
  {
    id: 'chatgpt',
    label: 'Use ChatGPT',
    icon: BookOpenIcon,
    color: 'peach',
    category: 'guides',
    shortcut: false,
  },
  {
    id: 'history',
    label: 'Change history',
    icon: ClockCounterClockwiseIcon,
    color: 'rose',
    category: 'apps',
    shortcut: false,
  },
] as const satisfies readonly {
  id: DesktopApp;
  label: string;
  icon: typeof FolderOpenIcon;
  color: string;
  category: DesktopCategory;
  shortcut: boolean;
}[];
