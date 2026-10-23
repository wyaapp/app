import type { ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { GameControllerIcon } from '@phosphor-icons/react/dist/ssr/GameController';
import { LinkIcon } from '@phosphor-icons/react/dist/ssr/Link';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { PaletteIcon } from '@phosphor-icons/react/dist/ssr/Palette';
import { PaintBrushIcon } from '@phosphor-icons/react/dist/ssr/PaintBrush';
import { BrowserIcon } from '@phosphor-icons/react/dist/ssr/Browser';
import { GearSixIcon } from '@phosphor-icons/react/dist/ssr/GearSix';
import { UserIcon } from '@phosphor-icons/react/dist/ssr/User';
import type { Profile } from '@/lib/profile-types';
import type { ProfileTab } from '@/lib/profile-tabs';
import type { SpacePageFile } from '@/lib/space-page-files';
import { getLayoutGroups } from '@/lib/link-layout';
import { profileThemes, themeIds, type ProfileTheme } from '@/lib/profile-themes';
import { fontIds, profileFonts, type ProfileFont } from '@/lib/profile-fonts';
import { BrandSpark } from '../brand-spark';
import { BioText } from '../bio-text';
import { ProfileAvatar } from '../profile-avatar';
import { ProfileSections } from '../profile-sections';
import type { useTranslation } from '../language-provider';
import type { DesktopOwnerControls } from './owner-controls';
import type { DesktopCategory } from './app-categories';
import { PaintApp } from './paint-app';
import { DesktopSettings } from './desktop-settings';
import type { useDesktopFiles } from './use-desktop-files';
import { FilesApp } from './files-app';
import { TextEditor, TextEditorWelcome } from './text-editor';
import type { DesktopDrag } from './use-desktop-drag';

/** A window instance names its application and optional resource independently. */
export type DesktopAppEntry = {
  id: string;
  applicationId: string;
  resource?: { kind: 'file' | 'page'; id: string };
  title: string;
  Icon: PhosphorIcon;
  color: string;
  category: DesktopCategory;
  filename?: string;
  launcher?: boolean;
  shortcut?: boolean;
  keepMounted?: boolean;
  lazy?: boolean;
  windowClassName?: string;
  private?: boolean;
  render: (active: boolean) => ReactNode;
};

type AppContext = {
  profile: Profile;
  pageTabs: ProfileTab[];
  pageFiles: SpacePageFile[];
  firstTab: ProfileTab;
  files: ReturnType<typeof useDesktopFiles>;
  drag: DesktopDrag;
  owner?: DesktopOwnerControls;
  canEdit: boolean;
  preview: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  profileView: { loaded: boolean; editing: boolean };
  theme: ProfileTheme;
  selectedFont: ProfileFont;
  appearanceStatus: 'idle' | 'saving' | 'saved' | 'error';
  requestedFolder?: { id: string; sequence: number };
  onFolderRequestHandled: (sequence: number) => void;
  openApp: (id: string) => Promise<void>;
  openDocument: (id: string) => Promise<void>;
  editProfile: () => Promise<void>;
  viewProfile: () => Promise<void>;
  resetDesktop: () => Promise<void>;
  chooseAppearance: (change: { theme?: ProfileTheme; font?: ProfileFont }) => Promise<void>;
};

/** App registration is shared by shortcuts, taskbar, window rendering and session restore. */
export function createDesktopApps(context: AppContext): DesktopAppEntry[] {
  const {
    profile,
    pageTabs,
    pageFiles,
    files,
    drag,
    owner,
    canEdit,
    t,
    profileView,
    appearanceStatus,
    openApp,
    openDocument,
    resetDesktop,
  } = context;
  const desktopFolderId = files.folders.find((folder) => folder.system === 'desktop')?.id;
  const apps: DesktopAppEntry[] = [
    {
      id: 'about',
      applicationId: 'profile',
      title: t('Profile'),
      Icon: UserIcon,
      color: 'lilac',
      category: 'content',
      keepMounted: profileView.loaded,
      windowClassName: canEdit && profileView.editing ? 'desktop-management-window' : '',
      render: () => <ProfileApplication {...context} />,
    },
    ...pageTabs.map((tab, index): DesktopAppEntry => {
      const slugs = new Set(getLayoutGroups(tab).flatMap((group) => group.slugs));
      const items = profile.links.filter((item) => slugs.has(item.slug) && item.visible);
      const games =
        items.length > 0 &&
        items.every((item) => item.kind === 'interest' || item.kind === 'collection');
      const projects = items.length > 0 && items.every((item) => item.kind === 'project');
      return {
        id: `tab-${tab.id}`,
        applicationId: 'page-viewer',
        resource: { kind: 'page', id: tab.id },
        title: tab.title,
        filename: `${tab.slug}.wya`,
        launcher: false,
        shortcut: Boolean(
          desktopFolderId &&
          pageFiles.find((page) => page.id === tab.id)?.folderId === desktopFolderId,
        ),
        Icon: games ? GameControllerIcon : projects ? BrowserIcon : LinkIcon,
        color: ['yellow', 'lime', 'peach', 'sky', 'rose'][index % 5],
        category: 'content',
        render: () => <PageApplication {...context} tab={tab} />,
      };
    }),
    {
      id: 'files',
      applicationId: 'explorer',
      title: t('Files'),
      Icon: FolderOpenIcon,
      color: 'yellow',
      category: 'content',
      lazy: true,
      keepMounted: true,
      windowClassName: 'desktop-file-window',
      render: () => (
        <FilesApp
          key={files.scope}
          files={files}
          editable={canEdit}
          pages={pageFiles}
          drag={drag}
          onOpenPage={(id) => void openApp(`tab-${id}`)}
          onOpen={(id) => void openDocument(id)}
          requestedFolder={context.requestedFolder}
          onFolderRequestHandled={context.onFolderRequestHandled}
          desktopApps={apps.filter(
            (app) =>
              (canEdit || !app.private) &&
              !app.resource &&
              app.shortcut !== false &&
              app.launcher !== false,
          )}
          onOpenApp={(id) => void openApp(id)}
        />
      ),
    },
    ...files.files.map((file): DesktopAppEntry => ({
      id: `file-${file.id}`,
      applicationId: 'text-editor',
      resource: { kind: 'file', id: file.id },
      title: file.name,
      Icon: FileTextIcon,
      color: /\.md$/i.test(file.name) ? 'lilac' : 'sky',
      category: 'content',
      shortcut: Boolean(desktopFolderId && file.folderId === desktopFolderId),
      launcher: false,
      lazy: true,
      keepMounted: true,
      windowClassName: 'desktop-file-window',
      render: () => {
        const document = files.documents.find((item) => item.id === file.id);
        return document ? (
          <TextEditor
            key={`${files.scope}:${file.id}`}
            file={document}
            files={files}
            editable={canEdit}
          />
        ) : null;
      },
    })),
    {
      id: 'text-editor',
      applicationId: 'text-editor',
      title: t('Text Editor'),
      Icon: FileTextIcon,
      color: 'lilac',
      category: 'apps',
      shortcut: false,
      lazy: true,
      keepMounted: true,
      windowClassName: 'desktop-file-window',
      render: () => <TextEditorWelcome onBrowse={() => void openApp('files')} />,
    },
    {
      id: 'paint',
      applicationId: 'paint',
      title: t('Paint'),
      Icon: PaintBrushIcon,
      color: 'sky',
      category: 'apps',
      lazy: true,
      keepMounted: true,
      windowClassName: 'desktop-paint',
      render: (active) => <PaintApp active={active} />,
    },
    {
      id: 'settings',
      applicationId: 'settings',
      title: t('Settings'),
      Icon: GearSixIcon,
      color: 'peach',
      category: 'settings',
      render: () => (
        <DesktopSettings
          apps={canEdit ? owner!.apps.filter((app) => app.category === 'settings') : []}
          disabled={canEdit && (owner!.busy || appearanceStatus === 'saving')}
          onOpen={(id) => void openApp(id)}
          onReset={() => void resetDesktop()}
        />
      ),
    },
    {
      id: 'appearance',
      applicationId: 'appearance',
      title: t('Appearance'),
      Icon: PaletteIcon,
      color: 'peach',
      category: 'settings',
      shortcut: false,
      launcher: false,
      render: () => <AppearanceApplication {...context} />,
    },
    ...(owner?.apps ?? []).map((app): DesktopAppEntry => ({
      ...app,
      applicationId: app.id,
      private: true,
      lazy: true,
      keepMounted: true,
      windowClassName: 'desktop-management-window',
      render: () => app.content,
    })),
  ];
  return apps;
}

function ProfileApplication({
  profile,
  profileView,
  owner,
  canEdit,
  preview,
  pageTabs,
  firstTab,
  t,
  editProfile,
  viewProfile,
  openApp,
}: AppContext) {
  return (
    <>
      {profileView.loaded && owner && (
        <div className="desktop-profile-editor" hidden={!canEdit || !profileView.editing}>
          <button
            type="button"
            className="desktop-profile-back"
            onClick={() => void viewProfile()}
            disabled={owner!.busy}
          >
            <ArrowLeftIcon weight="regular" aria-hidden="true" size={16} />
            {t('Back to profile')}
          </button>
          {owner.profileEditor}
        </div>
      )}
      <div className="desktop-identity space-typography" hidden={canEdit && profileView.editing}>
        <div className="desktop-identity-top">
          <ProfileAvatar name={profile.name} url={profile.pictureUrl} />
          {canEdit && (
            <button
              type="button"
              className="desktop-edit-button"
              onClick={() => void editProfile()}
              disabled={owner!.busy}
            >
              <PencilSimpleIcon weight="regular" aria-hidden="true" size={16} />
              {t('Edit')}
            </button>
          )}
          <span className="desktop-identity-spark" aria-hidden="true">
            <BrandSpark />
          </span>
        </div>
        <span className="eyebrow">{t('HEY, I AM')}</span>
        {preview ? <h2>{profile.name}</h2> : <h1>{profile.name}</h1>}
        <span className="desktop-handle">@{profile.handle}</span>
        <p className="desktop-bio">
          <BioText text={profile.bio || t('A little corner of the internet.')} />
        </p>
        {pageTabs.length > 0 && (
          <button className="button" type="button" onClick={() => openApp(`tab-${firstTab.id}`)}>
            {t('Find me around')}
            <ArrowRightIcon weight="regular" aria-hidden="true" size={18} />
          </button>
        )}
        <div className="desktop-identity-footer">
          <span>{t('WHERE YOU AT?')}</span>
          <strong>{t('RIGHT HERE ↗')}</strong>
        </div>
      </div>
    </>
  );
}

function PageApplication({
  profile,
  canEdit,
  owner,
  preview,
  tab,
}: AppContext & { tab: ProfileTab }) {
  return (
    <>
      {canEdit && <div className="desktop-tab-actions">{owner!.tabActions(tab)}</div>}
      <div className="space-typography">
        <ProfileSections
          profile={profile}
          tab={tab}
          preview={preview}
          onEdit={canEdit ? (item) => owner!.editItem(item, tab) : undefined}
        />
      </div>
    </>
  );
}

function AppearanceApplication({
  profile,
  canEdit,
  owner,
  t,
  theme,
  selectedFont,
  appearanceStatus,
  chooseAppearance,
}: AppContext) {
  return (
    <div className="desktop-appearance">
      <p>
        {t(
          canEdit
            ? 'Style your content. Changes save automatically.'
            : 'Try a different look. Just for your visit.',
        )}
      </p>
      <h4>{t('Color')}</h4>
      <div className="desktop-colors" role="group" aria-label={t('Your color')}>
        {themeIds.map((value) => (
          <button
            type="button"
            key={value}
            onClick={() => void chooseAppearance({ theme: value })}
            disabled={canEdit && (appearanceStatus === 'saving' || owner!.busy)}
            aria-pressed={theme === value}
            style={{
              background: profileThemes[value].color,
              color: profileThemes[value].text,
            }}
          >
            <span>{t(profileThemes[value].label)}</span>
            {theme === value && <CheckIcon weight="regular" aria-hidden="true" size={16} />}
          </button>
        ))}
      </div>
      <h4>{t('Typography')}</h4>
      <p className="subtle">{t('For your content. Desktop controls stay the same.')}</p>
      <div className="desktop-fonts" role="group" aria-label={t('Typography')}>
        {fontIds.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={selectedFont === value}
            disabled={canEdit && (appearanceStatus === 'saving' || owner!.busy)}
            onClick={() => void chooseAppearance({ font: value })}
          >
            <span className="desktop-font-sample" style={{ fontFamily: profileFonts[value].body }}>
              Aa
            </span>
            <span>{t(profileFonts[value].label)}</span>
            {selectedFont === value && <CheckIcon weight="regular" aria-hidden="true" size={16} />}
          </button>
        ))}
      </div>
      <div className="desktop-type-preview space-typography">
        <h3>{profile.name}</h3>
        <p>{profile.bio || t('A little corner of the internet.')}</p>
      </div>
      {canEdit && (
        <span className="desktop-color-status" role="status">
          {appearanceStatus !== 'idle' &&
            t(
              {
                saving: 'Saving…',
                saved: 'Appearance saved.',
                error: 'Could not save appearance. Try again.',
              }[appearanceStatus],
            )}
        </span>
      )}
    </div>
  );
}
