import type { TaskbarPinControls } from './taskbar';
import type { ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { PaletteIcon } from '@phosphor-icons/react/dist/ssr/Palette';
import { PaintBrushIcon } from '@phosphor-icons/react/dist/ssr/PaintBrush';
import { CalculatorIcon } from '@phosphor-icons/react/dist/ssr/Calculator';
import { GearSixIcon } from '@phosphor-icons/react/dist/ssr/GearSix';
import { DeviceMobileIcon } from '@phosphor-icons/react/dist/ssr/DeviceMobile';
import { UserIcon } from '@phosphor-icons/react/dist/ssr/User';
import type { Profile } from '@/lib/profile-types';
import { getFileFormat, isRichTextFile } from '@/lib/file-formats';
import { availableCopyName } from '@/lib/desktop-entries';
import { parseWidgetSource } from '@/lib/widget-files';
import type { DocumentAppearance } from '@/lib/document-appearance';
import { profileThemes, themeIds, type ProfileTheme } from '@/lib/profile-themes';
import { fontIds, profileFonts, type ProfileFont } from '@/lib/profile-fonts';
import { BrandSpark } from '../brand-spark';
import { BioText } from '../bio-text';
import { ProfileAvatar } from '../profile-avatar';
import type { useTranslation } from '../language-provider';
import type { DesktopOwnerControls } from './owner-controls';
import type { DesktopCategory } from './app-categories';
import { PaintApp } from './paint-app';
import { CalculatorApp } from './calculator-app';
import { DesktopSettings } from './desktop-settings';
import { MobileLayoutApp } from './mobile-layout-app';
import type { useDesktopFiles } from './use-desktop-files';
import { FilesApp } from './files-app';
import { TextEditor, TextEditorWelcome } from './text-editor';
import type { DesktopDrag } from './use-desktop-drag';

/** A window instance names its application and optional resource independently. */
export type DesktopAppEntry = {
  id: string;
  applicationId: string;
  resource?: { kind: 'file'; id: string };
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
  appearance?: DocumentAppearance;
  private?: boolean;
  pinnable?: boolean;
  onRename?: (name: string) => Promise<void>;
  render: (active: boolean, taskbar: TaskbarPinControls) => ReactNode;
};

type AppContext = {
  profile: Profile;
  mobileFileIds: readonly string[];
  defaultFileId?: string;
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
      title: t('Bio'),
      Icon: UserIcon,
      color: 'lilac',
      category: 'content',
      keepMounted: profileView.loaded,
      windowClassName: canEdit && profileView.editing ? 'desktop-management-window' : '',
      render: () => <ProfileApplication {...context} />,
    },
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
      render: (_active, taskbar) => (
        <FilesApp
          {...taskbar}
          key={files.scope}
          files={files}
          editable={canEdit}
          drag={drag}
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
      applicationId: getFileFormat(file.name) === 'widget' ? 'widget' : 'text-editor',
      resource: { kind: 'file', id: file.id },
      title: file.name,
      onRename: canEdit ? (name) => files.rename(file, name) : undefined,
      Icon: getFileFormat(file.name) === 'widget' ? SquaresFourIcon : FileTextIcon,
      color: isRichTextFile(file.name) ? 'lilac' : 'sky',
      category: 'content',
      shortcut: Boolean(desktopFolderId && file.folderId === desktopFolderId),
      launcher: false,
      lazy: true,
      keepMounted: true,
      windowClassName: 'desktop-file-window',
      appearance: file.appearance,
      render: () => {
        const document = files.documents.find((item) => item.id === file.id);
        return document ? (
          <TextEditor
            key={`${files.scope}:${file.id}`}
            file={document}
            files={files}
            editable={canEdit}
            profile={profile}
            registerGuard={owner?.registerDocumentGuard}
            onCreateWidget={
              canEdit
                ? async (content) => {
                    parseWidgetSource(content, { allowEmpty: false });
                    const name = availableCopyName(
                      `${file.name.replace(/\.[^.]+$/, '').slice(0, 93)}.widget`,
                      files.files
                        .filter((item) => item.folderId === file.folderId)
                        .map((item) => item.name),
                    );
                    const copy = await files.change({
                      action: 'create',
                      name,
                      content,
                      folderId: file.folderId,
                      appearance: file.appearance,
                    });
                    if (copy) await openDocument(copy.id);
                  }
                : undefined
            }
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
      id: 'calculator',
      applicationId: 'calculator',
      title: t('Calculator'),
      Icon: CalculatorIcon,
      color: 'lime',
      category: 'apps',
      lazy: true,
      keepMounted: true,
      windowClassName: 'desktop-calculator',
      render: (active) => <CalculatorApp active={active} />,
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
          key={profile.id}
          apps={canEdit ? apps.filter((app) => app.private && app.category === 'settings') : []}
          disabled={canEdit && (owner!.busy || appearanceStatus === 'saving')}
          onOpen={(id) => void openApp(id)}
          onReset={() => void resetDesktop()}
        />
      ),
    },
    {
      id: 'mobile-layout',
      applicationId: 'mobile-layout',
      title: t('Page layout'),
      Icon: DeviceMobileIcon,
      color: 'sky',
      category: 'settings',
      private: true,
      lazy: true,
      keepMounted: true,
      windowClassName: 'desktop-management-window',
      render: () =>
        canEdit && owner ? (
          <MobileLayoutApp
            key={profile.id}
            files={files.files}
            value={context.mobileFileIds}
            screens={profile.mobileLayout?.screens}
            disabled={owner.busy}
            registerGuard={owner.registerDocumentGuard}
            onSave={(layout) => owner.saveMobileLayout(layout)}
            onOpenFiles={() => void openApp('files')}
          />
        ) : null,
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
      windowClassName: app.windowClassName ?? 'desktop-management-window',
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
  defaultFileId,
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
            {t('Back to Bio')}
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
        {defaultFileId && (
          <button className="button" type="button" onClick={() => openApp(`file-${defaultFileId}`)}>
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
      <p className="subtle">{t('For your content. Home controls stay the same.')}</p>
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
