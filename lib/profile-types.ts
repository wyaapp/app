import type { ItemButton } from './item-buttons.ts';
import type { CollectionContent } from './collection-types.ts';
import type { InterestContent } from './interests.ts';
import type { ProfileTab } from './profile-tabs.ts';
import type { LinkSection } from './link-layout.ts';
import type { ProfileTheme } from './profile-themes.ts';
import type { ProfileFont } from './profile-fonts.ts';
import type { Platform, LinkIconId } from './link-options.ts';
import type { DiscordConfig } from './discord-widget-types.ts';
import type { SpaceFile } from './space-files.ts';

export type ProjectContent = { description: string; coverUrl?: string; buttons: ItemButton[] };
export const MAX_PROJECTS = 12;
export const MAX_LINK_ALIASES = 10;
export type LinkItem = {
  id?: string;
  // Derived lookup ownership; never accepted as an editable card field.
  fileId?: string;
  aliases?: string[];
  kind?: 'project' | 'interest' | 'collection' | 'discord';
  discord?: DiscordConfig;
  collection?: CollectionContent;
  project?: ProjectContent;
  interest?: InterestContent;
  slug: string;
  label: string;
  url: string;
  platform: Platform;
  icon?: LinkIconId;
  visible: boolean;
  sectionId?: string;
};
export type ProfileData = {
  name: string;
  bio: string;
  theme: ProfileTheme;
  font?: ProfileFont;
  pageStyle?: 'classic' | 'desktop';
  desktopOrder?: string[];
  mainWindowId?: string;
  files?: SpaceFile[];
  defaultFileId?: string;
  fileModelVersion?: 1;
  // Legacy revision and action-adapter fields. Live document content is stored in files.
  documents?: Record<string, string>;
  links: LinkItem[];
  sections?: LinkSection[];
  ungroupedPosition?: number;
  tabs?: ProfileTab[];
  defaultTabId?: string;
};
export type Profile = ProfileData & {
  id: string;
  aliases: string[];
  handle: string;
  version: number;
  updatedAt: string;
  pictureUrl?: string | null;
  // Derived from domain settings, never persisted in profile content/revisions.
  publicDomain?: { hostname: string; redirect: boolean };
};
export type SpaceSummary = Pick<Profile, 'id' | 'handle' | 'name' | 'theme' | 'version'>;
export type Revision = { version: number; reason: string; createdAt: string };
