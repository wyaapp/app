'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { HouseIcon } from '@phosphor-icons/react/dist/ssr/House';
import { DesktopTaskbarApps } from './taskbar';
import { FolderIcon } from '@phosphor-icons/react/dist/ssr/Folder';
import type { SpaceFile } from '@/lib/space-files';
import { FilePropertiesDialog } from './file-properties-dialog';
import type { Profile } from '@/lib/profile-types';
import { fileForFragment, fileFragmentTarget } from '@/lib/page-fragments';
import { fileNavigationOrder } from '@/lib/file-navigation';
import { legacyFileAppIds, remapDesktopIds } from '@/lib/legacy-desktop-files';
import { profileThemeStyle, type ProfileTheme } from '@/lib/profile-themes';
import { useTranslation } from '../language-provider';
import { DesktopWindow } from './desktop-window';
import { initialWindows } from './window-state';
import { createDesktopApps } from './app-registry';
import { useDesktopSession } from './use-desktop-session';
import {
  canMoveEntry,
  desktopEntries,
  entryCommands,
  findDesktopEntry,
} from '@/lib/desktop-entries';
import { DesktopStartMenu } from './start-menu';
import type { DesktopOwnerControls } from './owner-controls';
import { spaceAddress } from '@/lib/public-address';
import { profileFontStyle, type ProfileFont } from '@/lib/profile-fonts';
import { desktopCategoryIds } from './app-categories';
import { useDesktopFiles } from './use-desktop-files';
import { DesktopShortcuts, type DesktopShortcut } from './desktop-shortcuts';
import { useDesktopDrag } from './use-desktop-drag';
import { useDesktopIconLayout } from './use-desktop-icon-layout';
import { DESKTOP_ICON } from '@/lib/desktop-icon-layout';
import {
  desktopAppId,
  desktopItem,
  moveDesktopItem,
  orderedDesktopItems,
  type DesktopItem,
} from '@/lib/desktop-items';

export function DesktopProfile({
  profile,
  preview = false,
  createHref = '/',
  owner,
}: {
  profile: Profile;
  preview?: boolean;
  createHref?: string;
  owner?: DesktopOwnerControls;
}) {
  const { t } = useTranslation();
  const canEdit = !!owner && !owner.visitor;
  const controlled = preview || !!owner;
  const [profileView, setProfileView] = useState({
    editing: owner?.requestedApp?.id === 'owner-profile',
    loaded: owner?.requestedApp?.id === 'owner-profile',
    request: owner?.requestedApp?.sequence,
  });
  // A direct profile route selects the edit view before the next paint.
  if (
    owner?.requestedApp?.id === 'owner-profile' &&
    profileView.request !== owner.requestedApp.sequence
  ) {
    setProfileView({ editing: true, loaded: true, request: owner.requestedApp.sequence });
  }
  const [color, setColor] = useState<ProfileTheme | null>(null);
  const [appearanceStatus, setAppearanceStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const appearanceSaveInFlight = useRef(false);
  const [font, setFont] = useState<ProfileFont | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const locationRead = useRef(false);
  const startButton = useRef<HTMLButtonElement>(null);
  const dockButtons = useRef(new Map<string, HTMLButtonElement>());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const theme = canEdit ? profile.theme : (color ?? profile.theme);
  const selectedFont = canEdit
    ? (profile.font ?? 'original')
    : (font ?? profile.font ?? 'original');
  const address = spaceAddress(profile);
  const files = useDesktopFiles(profile.id, profile.handle, canEdit, owner?.onFilesChanged);
  const idAliases = useMemo(() => legacyFileAppIds(files.files), [files.files]);
  const defaultFileId = files.loading ? profile.defaultFileId : (files.defaultFileId ?? undefined);
  const firstDocument =
    files.files.find((file) => file.id === defaultFileId) ??
    fileNavigationOrder(files.files.filter((file) => file.published))[0];
  const initialState = initialWindows(
    firstDocument ? `file-${firstDocument.id}` : 'about',
    'about',
  );
  const drag = useDesktopDrag(profile.id);
  const [desktopOrder, setDesktopOrder] = useState<{ scope: string; ids: string[] } | null>(null);
  const desktopScope = `${profile.id}:${canEdit ? 'owner' : 'visitor'}`;
  const [shortcutSelection, setShortcutSelection] = useState<{ scope: string; id: string } | null>(
    null,
  );
  const folderRequestSequence = useRef(0);
  const [folderRequest, setFolderRequest] = useState<{
    scope: string;
    id: string;
    sequence: number;
  } | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const organizingRef = useRef(false);
  const [desktopError, setDesktopError] = useState('');
  const [fileProperties, setFileProperties] = useState<SpaceFile | null>(null);
  const [renameRequests, setRenameRequests] = useState<Record<string, number>>({});
  const desktopFolder = files.folders.find((folder) => folder.system === 'desktop');
  const registerFileGuard = owner?.registerFileGuard;
  useEffect(() => {
    registerFileGuard?.(files.flushAll);
    return () => registerFileGuard?.(async () => true);
  }, [registerFileGuard, files.flushAll]);
  const apps = createDesktopApps({
    profile,
    defaultFileId: firstDocument?.id,
    files,
    drag,
    owner,
    canEdit,
    preview,
    t,
    profileView,
    theme,
    selectedFont,
    appearanceStatus,
    requestedFolder: folderRequest?.scope === desktopScope ? folderRequest : undefined,
    onFolderRequestHandled: (sequence) => {
      setFolderRequest((request) =>
        request?.scope === desktopScope && request.sequence === sequence ? null : request,
      );
    },
    openApp,
    openDocument,
    editProfile,
    viewProfile,
    resetDesktop,
    chooseAppearance,
  });
  const fileApps = apps.filter((app) => app.resource?.kind === 'file');
  const publicApps = apps.filter((app) => !app.private);
  const visibleApps = canEdit ? apps : publicApps;
  const folderShortcuts = files.folders.map((folder) => ({
    id: `folder-${folder.id}`,
    folderId: folder.id,
    title: folder.system === 'desktop' ? t('Home') : folder.name,
    Icon: folder.system === 'desktop' ? HouseIcon : FolderIcon,
    color: 'yellow',
  }));
  const taskbarEntries = [...visibleApps, ...folderShortcuts];
  const shortcuts = orderedDesktopItems<DesktopShortcut>(
    [
      ...visibleApps
        .filter((app) =>
          'shortcut' in app
            ? app.shortcut !== false
            : !('launcher' in app) || app.launcher !== false,
        )
        .sort(
          (a, b) => desktopCategoryIds.indexOf(a.category) - desktopCategoryIds.indexOf(b.category),
        ),
      ...folderShortcuts.filter((shortcut) =>
        files.folders.some(
          (folder) =>
            folder.id === shortcut.folderId &&
            desktopFolder &&
            folder.parentId === desktopFolder.id,
        ),
      ),
    ],
    desktopOrder?.scope === desktopScope
      ? desktopOrder.ids
      : remapDesktopIds(profile.desktopOrder ?? [], idAliases),
  );
  const visibleIds = new Set(visibleApps.map((app) => app.id));
  const entries = desktopEntries(files.files, files.folders, canEdit);
  const commands = entryCommands(files, files.folders);
  const iconLayout = useDesktopIconLayout(
    desktopScope,
    shortcuts.map((app) => app.id),
    workspace,
    preview,
    idAliases,
  );
  const openFile = files.open;
  const restoreDocuments = useCallback(
    async (ids: string[]) => {
      const opened = await Promise.all(ids.map(async (id) => ((await openFile(id)) ? id : null)));
      return opened.filter((id): id is string => id !== null);
    },
    [openFile],
  );
  const { windows, dispatch, positions, setPosition, ready, pinnedIds, toggleTaskbarPin } =
    useDesktopSession({
      spaceId: profile.id,
      mode: canEdit ? 'owner' : 'visitor',
      initialState,
      availableIds: visibleApps.map((app) => app.id),
      pinnableIds: taskbarEntries
        .filter((entry) => !('pinnable' in entry) || entry.pinnable !== false)
        .map((entry) => entry.id),
      metadataReady: !files.loading,
      metadataError: !!files.metadataError,
      restoreDocuments,
      enabled: !preview,
      idAliases,
    });
  const active = ready ? windows.order.filter((id) => visibleIds.has(id)).at(-1) : undefined;
  const requestedApp = owner?.requestedApp?.id;
  const requestedAvailable = visibleIds.has(
    requestedApp === 'owner-profile' ? 'about' : (requestedApp ?? ''),
  );
  const requestKey = owner?.requestedApp?.sequence;
  const consumedRequest = useRef<string | null>(null);

  async function reorderDesktop(id: string, target: string) {
    if (organizingRef.current || (canEdit && owner.busy)) return;
    const current = shortcuts.map((app) => app.id);
    const next = moveDesktopItem(current, id, target);
    if (next === current) return;
    setDesktopOrder({ scope: desktopScope, ids: next });
    if (!canEdit) return;
    organizingRef.current = true;
    setOrganizing(true);
    setDesktopError('');
    try {
      if (!(await owner.saveDesktopOrder(next))) {
        setDesktopOrder({ scope: desktopScope, ids: current });
        setDesktopError('Could not save the Home arrangement. Try again.');
      }
    } catch {
      setDesktopOrder({ scope: desktopScope, ids: current });
      setDesktopError('Could not save the Home arrangement. Try again.');
    } finally {
      organizingRef.current = false;
      setOrganizing(false);
    }
  }
  function canMoveDesktopItem(item: DesktopItem, folderId: string | null) {
    const entry = findDesktopEntry(entries, item);
    return (
      canEdit &&
      !organizing &&
      !owner?.busy &&
      !!entry &&
      canMoveEntry(entry, files.folders, folderId)
    );
  }
  async function moveDocument(item: DesktopItem, folderId: string | null) {
    if (!canEdit || organizingRef.current || owner.busy) return false;
    organizingRef.current = true;
    setOrganizing(true);
    setDesktopError('');
    try {
      const entry = findDesktopEntry(entries, item);
      if (!entry) return false;
      await commands.move(entry, folderId);
      return true;
    } catch (error) {
      setDesktopError((error as Error).message);
      return false;
    } finally {
      organizingRef.current = false;
      setOrganizing(false);
    }
  }
  const desktopDrop = drag.target(
    'desktop-folder',
    (item) =>
      !organizing &&
      !owner?.busy &&
      ((iconLayout.positioned && shortcuts.some((app) => app.id === desktopAppId(item))) ||
        Boolean(desktopFolder && canMoveDesktopItem(item, desktopFolder.id))),
    // eslint-disable-next-line react-hooks/refs -- The adapter registers this drop handler; it runs only after an interaction.
    (item, location) => {
      const id = desktopAppId(item);
      if (shortcuts.some((app) => app.id === id)) {
        iconLayout.drop(id, location);
        setShortcutSelection({ scope: desktopScope, id });
      } else if (desktopFolder) {
        void moveDocument(item, desktopFolder.id).then((moved) => {
          if (moved) iconLayout.drop(id, location);
        });
      }
    },
    { exclude: '.desktop-window' },
  );

  async function chooseAppearance(change: { theme?: ProfileTheme; font?: ProfileFont }) {
    if (!canEdit) {
      if (change.theme) setColor(change.theme);
      if (change.font) setFont(change.font);
      return;
    }
    if (appearanceSaveInFlight.current || owner.busy) return;
    if (change.theme === theme || change.font === selectedFont) return;
    appearanceSaveInFlight.current = true;
    setAppearanceStatus('saving');
    try {
      const saved = await owner.saveAppearance(change);
      if (saved) {
        setColor(null);
        setFont(null);
      }
      setAppearanceStatus(saved ? 'saved' : 'error');
    } catch {
      setAppearanceStatus('error');
    } finally {
      appearanceSaveInFlight.current = false;
    }
  }

  async function openApp(id: string) {
    if (!ready) return;
    const item = desktopItem(id);
    if (item.kind === 'folder') {
      if (!files.folders.some((folder) => folder.id === item.id)) return;
      setFolderRequest({
        scope: desktopScope,
        id: item.id,
        sequence: ++folderRequestSequence.current,
      });
      dispatch({ type: 'open', id: 'files' });
      return;
    }
    if (!visibleIds.has(id)) return;
    const app = apps.find((entry) => entry.id === id);
    if (app?.resource?.kind === 'file') {
      await openDocument(app.resource.id);
      return;
    }
    if (
      canEdit &&
      (id === 'files' || owner.apps.some((app) => app.id === id)) &&
      !(await owner.openApp(id))
    )
      return;
    dispatch({ type: 'open', id });
    if (workspace.current && workspace.current.clientWidth <= 960)
      workspace.current.scrollTo({ top: 0 });
  }

  async function renameApp(id: string) {
    const app = apps.find((entry) => entry.id === id);
    if (!app?.onRename || !app.resource) return;
    if (app.resource.kind === 'file' && !(await files.open(app.resource.id))) return;
    dispatch({ type: 'open', id });
    setRenameRequests((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  }

  async function editProfile() {
    if (!canEdit || !(await owner.openApp('owner-profile'))) return;
    setProfileView((current) => ({ ...current, editing: true, loaded: true }));
    dispatch({ type: 'open', id: 'about' });
  }

  async function viewProfile() {
    if (canEdit && !(await owner.beforeHide('about', false))) return;
    setProfileView((current) => ({ ...current, editing: false }));
  }

  async function openDocument(id: string) {
    if (await files.open(id)) {
      dispatch({ type: 'open', id: `file-${id}` });
      if (workspace.current && workspace.current.clientWidth <= 960)
        workspace.current.scrollTo({ top: 0 });
    }
  }

  async function hideApp(id: string, close = false) {
    if (canEdit && !(await owner.beforeHide(id, close))) return;
    dispatch({ type: close ? 'close' : 'hide', id });
    requestAnimationFrame(() => {
      (dockButtons.current.get(id) ?? startButton.current)?.focus({ preventScroll: true });
    });
  }

  async function resetDesktop() {
    if (canEdit && !(await owner.beforeHide('', false))) return;
    if (firstDocument && !(await files.open(firstDocument.id))) return;
    setColor(null);
    setFont(null);
    iconLayout.resetAll();
    // Keep drawing and owner drafts mounted while restoring public window positions.
    setResetKey((key) => key + 1);
    dispatch({
      type: 'reset',
      firstTab: firstDocument ? `file-${firstDocument.id}` : 'about',
      active: 'about',
      preserve: [
        'paint',
        'calculator',
        'files',
        'text-editor',
        ...fileApps.map((app) => app.id),
        ...(owner?.apps.map((app) => app.id) ?? []),
      ],
    });
    dockButtons.current.get('about')?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!ready || !requestedApp || !requestedAvailable || !canEdit) return;
    const token = `${profile.id}:${requestedApp}:${requestKey}`;
    if (consumedRequest.current === token) return;
    consumedRequest.current = token;
    const id = requestedApp === 'owner-profile' ? 'about' : requestedApp;
    dispatch({ type: 'open', id });
    requestAnimationFrame(() => {
      document
        .getElementById(`desktop-${id}`)
        ?.querySelector<HTMLElement>('.desktop-window-handle')
        ?.focus({ preventScroll: true });
    });
  }, [ready, requestedApp, requestedAvailable, requestKey, canEdit, profile.id, dispatch]);

  // Item fragments open the containing Markdown file without remounting the desktop.
  useEffect(() => {
    if (controlled || !ready) return;
    let frame = 0;
    async function readLocation(event?: Event) {
      const url = new URL(window.location.href);
      let fragment = '';
      try {
        fragment = decodeURIComponent(url.hash.slice(1));
      } catch {
        /* Ignore malformed fragments. */
      }
      const file = fileForFragment(profile, fragment);
      if (file && (await openFile(file.id))) dispatch({ type: 'open', id: `file-${file.id}` });
      else if (event) dispatch({ type: 'open', id: 'about' });
      if (fragment)
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() =>
            document
              .getElementById(file ? fileFragmentTarget(file.id, fragment) : fragment)
              ?.scrollIntoView({ block: 'nearest' }),
          );
        });
    }
    if (!locationRead.current) {
      readLocation();
      locationRead.current = true;
    }
    window.addEventListener('popstate', readLocation);
    window.addEventListener('hashchange', readLocation);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', readLocation);
      window.removeEventListener('hashchange', readLocation);
    };
  }, [profile, controlled, ready, dispatch, openFile]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setManualCopy(false);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2200);
    } catch {
      setManualCopy(true);
    }
  }

  return (
    <div
      aria-busy={!ready}
      inert={!ready}
      className={`desktop-profile ${preview ? 'desktop-preview' : ''}`}
      style={
        {
          ...profileThemeStyle(theme),
          ...profileFontStyle(selectedFont),
          '--shortcut-width': `${DESKTOP_ICON.width}px`,
          '--shortcut-height': `${DESKTOP_ICON.height}px`,
          '--shortcut-gap': `${DESKTOP_ICON.gap}px`,
          '--shortcut-left': `${DESKTOP_ICON.left}px`,
          '--shortcut-top': `${DESKTOP_ICON.top}px`,
          '--shortcut-padding': `${DESKTOP_ICON.padding}px`,
          '--shortcut-bottom': `${DESKTOP_ICON.bottom}px`,
          '--desktop-dot-step': `${DESKTOP_ICON.dot}px`,
        } as CSSProperties
      }
    >
      {canEdit && fileProperties && (
        <FilePropertiesDialog
          file={fileProperties}
          files={files.files}
          defaultFileId={files.defaultFileId}
          onSave={files.change}
          onClose={() => setFileProperties(null)}
        />
      )}
      <div
        className={`desktop-workspace${active ? ' has-active-window' : ''}`}
        onPointerDownCapture={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest('.desktop-shortcut, .desktop-window, [role="menu"]')) {
            setShortcutSelection(null);
          }
        }}
        {...desktopDrop}
        data-icons-overflow={iconLayout.overflowing || undefined}
        data-repositioning={
          (iconLayout.positioned &&
            drag.item &&
            shortcuts.some((app) => app.id === desktopAppId(drag.item!))) ||
          undefined
        }
        ref={(element) => {
          workspace.current = element;
          return desktopDrop.ref(element);
        }}
        onDragOver={(event) => {
          // Files accepts uploads; dropping elsewhere must not navigate away from the desktop.
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'none';
            return;
          }
        }}
        onDrop={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            return;
          }
        }}
      >
        <div className="desktop-wallpaper-word" aria-hidden="true">
          where you at?
        </div>
        <DesktopShortcuts
          apps={shortcuts}
          freePositions={iconLayout.positioned ? iconLayout.positions : undefined}
          snapToGrid={iconLayout.mode === 'grid'}
          surfaceWidth={iconLayout.surfaceWidth}
          overflowing={iconLayout.overflowing}
          onPositionChange={iconLayout.move}
          onArrange={iconLayout.reset}
          selectedId={shortcutSelection?.scope === desktopScope ? shortcutSelection.id : null}
          onSelect={(id) => setShortcutSelection(id ? { scope: desktopScope, id } : null)}
          pinnedTaskbarIds={pinnedIds}
          onToggleTaskbarPin={toggleTaskbarPin}
          drag={drag}
          busy={organizing || !!(canEdit && owner.busy)}
          onOpen={(id) => void openApp(id)}
          canRename={(id) => !!apps.find((app) => app.id === id)?.onRename}
          onRename={(id) => void renameApp(id)}
          onProperties={
            canEdit
              ? (id) => {
                  const item = desktopItem(id);
                  if (item.kind === 'file')
                    void files
                      .read(item.id)
                      .then(setFileProperties)
                      .catch((cause: Error) => setDesktopError(cause.message));
                }
              : undefined
          }
          onReorder={(id, target) => void reorderDesktop(id, target)}
          canMoveToFolder={canMoveDesktopItem}
          onMoveToFolder={(item, folderId) => void moveDocument(item, folderId)}
          onUnpin={canEdit ? (id) => void moveDocument(desktopItem(id), null) : undefined}
        />
        {desktopDrop['data-drop-target'] &&
          !shortcuts.some((app) => drag.item && app.id === desktopAppId(drag.item)) && (
            <div className="desktop-drop-hint">{t('Move to Home')}</div>
          )}
        {desktopError && (
          <div className="desktop-organize-error" role="alert">
            {t(desktopError)}{' '}
            <button type="button" onClick={() => setDesktopError('')}>
              {t('Dismiss')}
            </button>
          </div>
        )}
        <div className="desktop-welcome">
          <span className="eyebrow">@{profile.handle}</span>
          <h2>{t('Make yourself at home.')}</h2>
          <button className="button" type="button" onClick={() => openApp('about')}>
            {t('Meet {name}', { name: profile.name })}
            <ArrowRightIcon weight="regular" aria-hidden="true" size={18} />
          </button>
        </div>
        <p className="desktop-hint">
          {t('A little corner of the internet.')}
          <span>{t('Open a window. Have a look around.')}</span>
        </p>
        {apps.map((app) => {
          const { id, title, Icon } = app;
          if (app.lazy && !windows.loaded.includes(id)) return null;
          return (
            <DesktopWindow
              key={id}
              layoutVersion={resetKey}
              position={positions[id] ?? null}
              onPositionChange={(point) => setPosition(id, point)}
              id={id}
              title={title}
              onRename={app.onRename}
              renameRequest={renameRequests[id] ?? 0}
              category={app.category}
              icon={<Icon weight="duotone" aria-hidden="true" size={17} />}
              index={
                app.resource?.kind === 'file'
                  ? 4
                  : apps
                      .filter((item) => item.resource?.kind !== 'file')
                      .findIndex((item) => item.id === id)
              }
              className={app.windowClassName}
              appearance={app.appearance}
              keepMounted={app.keepMounted}
              open={ready && visibleIds.has(id) && windows.order.includes(id)}
              active={active === id}
              maximized={windows.maximized.includes(id)}
              layer={windows.order.indexOf(id)}
              workspace={workspace}
              onFocus={() => dispatch({ type: 'focus', id })}
              onHide={() => void hideApp(id, true)}
              onMinimize={() => void hideApp(id)}
              onMaximize={() => dispatch({ type: 'maximize', id })}
            >
              {app.render(active === id, {
                pinnedTaskbarIds: pinnedIds,
                onToggleTaskbarPin: toggleTaskbarPin,
              })}
            </DesktopWindow>
          );
        })}
        {owner?.notification}
      </div>
      <footer className="desktop-taskbar" aria-label={t('Taskbar')}>
        <DesktopStartMenu
          triggerRef={startButton}
          pinnedTaskbarIds={pinnedIds}
          onToggleTaskbarPin={toggleTaskbarPin}
          apps={visibleApps.filter((app) => !('launcher' in app) || app.launcher !== false)}
          address={address}
          copied={copied}
          onCopy={() => void copyAddress()}
          onOpen={(id) => void openApp(id)}
        >
          {canEdit && owner.menuFooter}
        </DesktopStartMenu>
        <button
          className="desktop-home-button"
          type="button"
          onClick={async () => {
            if (canEdit && !(await owner.beforeHide('', false))) return;
            dispatch({ type: 'clear' });
          }}
          aria-label={t('Show Home')}
          title={t('Show Home')}
        >
          <HouseIcon weight="duotone" aria-hidden="true" size={21} />
        </button>
        <DesktopTaskbarApps
          entries={ready ? taskbarEntries : []}
          windows={windows}
          active={active}
          pinnedTaskbarIds={pinnedIds}
          onToggleTaskbarPin={toggleTaskbarPin}
          onOpen={(id) => void openApp(id)}
          onMinimize={(id) => void hideApp(id)}
          onClose={(id) => void hideApp(id, true)}
          onFocusFallback={() => startButton.current?.focus({ preventScroll: true })}
          buttonRef={(id, node) => {
            if (node) dockButtons.current.set(id, node);
            else dockButtons.current.delete(id);
          }}
        />
        {owner ? (
          owner.taskbar
        ) : (
          <>
            <a className="desktop-create" href={createHref} target="_top">
              {t('Get your wya')}
              <ArrowUpRightIcon weight="regular" aria-hidden="true" size={15} />
            </a>
            {!preview && <DesktopClock />}
          </>
        )}
      </footer>
      <div className="desktop-copy-status" role="status">
        {copied && (
          <span>
            <CheckIcon weight="regular" aria-hidden="true" size={16} />
            {t('Profile link copied.')}
          </span>
        )}
      </div>
      {manualCopy && (
        <div className="desktop-manual-copy">
          <label>
            {t('Copy profile link')}
            <input
              readOnly
              value={address}
              onFocus={(event) => event.currentTarget.select()}
              autoFocus
            />
          </label>
          <button type="button" onClick={() => setManualCopy(false)}>
            {t('Done')}
          </button>
        </div>
      )}
    </div>
  );
}

function DesktopClock() {
  const { locale } = useTranslation();
  const [time, setTime] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setTime(new Date());
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <time className="desktop-clock" dateTime={time?.toISOString()}>
      {time ? time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '--:--'}
    </time>
  );
}
