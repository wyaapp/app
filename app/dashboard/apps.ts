import { ChartBarIcon } from '@phosphor-icons/react/dist/ssr/ChartBar';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { GlobeIcon } from '@phosphor-icons/react/dist/ssr/Globe';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ClockCounterClockwise';
import { QuestionIcon } from '@phosphor-icons/react/dist/ssr/Question';
import { UserIcon } from '@phosphor-icons/react/dist/ssr/User';
import { CreditCardIcon } from '@phosphor-icons/react/dist/ssr/CreditCard';
import { ChatTeardropDotsIcon } from '@phosphor-icons/react/dist/ssr/ChatTeardropDots';
import { LifebuoyIcon } from '@phosphor-icons/react/dist/ssr/Lifebuoy';
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
    label: 'Bio',
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
    id: 'billing',
    label: 'Plans & billing',
    icon: CreditCardIcon,
    color: 'sky',
    category: 'settings',
    shortcut: false,
  },
  {
    id: 'help',
    label: 'Help',
    icon: QuestionIcon,
    color: 'sky',
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
  {
    id: 'feedback',
    label: 'Feedback',
    icon: ChatTeardropDotsIcon,
    color: 'yellow',
    category: 'guides',
    shortcut: true,
  },
  {
    id: 'support',
    label: 'Support',
    icon: LifebuoyIcon,
    color: 'sky',
    category: 'guides',
    shortcut: true,
  },
] as const satisfies readonly {
  id: DesktopApp;
  label: string;
  icon: typeof FolderOpenIcon;
  color: string;
  category: DesktopCategory;
  shortcut: boolean;
}[];
