'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { FolderIcon } from '@phosphor-icons/react/dist/ssr/Folder';
import type { Profile } from '@/lib/profile-types';
import { getProfileLayout } from '@/lib/profile-tabs';
import { getLayoutGroups } from '@/lib/link-layout';
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
import {
  desktopItem,
  moveDesktopItem,
  orderedDesktopItems,
  type DesktopItem,
} from '@/lib/desktop-items';

export function DesktopProfile({
  profile,
  selectedTab,
  preview = false,
  onSelectTab,
  createHref = '/',
  owner,
}: {
  profile: Profile;
  selectedTab?: string;
  preview?: boolean;
  onSelectTab?: (id: string) => void;
  createHref?: string;
  owner?: DesktopOwnerControls;
}) {
  const { t } = useTranslation();
  const canEdit = !!owner && !owner.visitor;
  const controlled = preview || !!owner;
  const layout = useMemo(() => getProfileLayout(profile), [profile]);
  // An explicit empty list is the public projection of a space with all pages hidden.
  const pageTabs = !canEdit && profile.tabs?.length === 0 ? [] : layout.tabs;
  const firstTab = layout.tabs.find((tab) => tab.id === layout.defaultTabId)!;
  const selected = layout.tabs.find((tab) => (controlled ? tab.id : tab.slug) === selectedTab);
  const selectedId = selected?.id;
  const initialState = initialWindows(
    `tab-${selected?.id ?? firstTab.id}`,
    selected ? `tab-${selected.id}` : 'about',
  );
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
  const lastSelectedTab = useRef(selectedId);
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
  const dockButtons = useRef(new Map<string, HTMLButtonElement>());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const theme = canEdit ? profile.theme : (color ?? profile.theme);
  const selectedFont = canEdit
    ? (profile.font ?? 'original')
    : (font ?? profile.font ?? 'original');
  const address = spaceAddress(profile);
  const files = useDesktopFiles(profile.id, profile.handle, canEdit);
  const drag = useDesktopDrag(profile.id);
  const [desktopOrder, setDesktopOrder] = useState<{ scope: string; ids: string[] } | null>(null);
  const desktopScope = `${profile.id}:${canEdit ? 'owner' : 'visitor'}`;
  const folderRequestSequence = useRef(0);
  const [folderRequest, setFolderRequest] = useState<{
    scope: string;
    id: string;
    sequence: number;
  } | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const organizingRef = useRef(false);
  const [desktopError, setDesktopError] = useState('');
  const desktopFolder = files.folders.find((folder) => folder.system === 'desktop');
  const pageFiles = pageTabs.map((tab) => {
    const saved = files.pages.find((page) => page.id === tab.id);
    const folderId = saved ? saved.folderId : (desktopFolder?.id ?? null);
    return {
      id: tab.id,
      name: `${tab.slug}.wya`,
      title: tab.title,
      folderId,
      pinned: Boolean(desktopFolder && folderId === desktopFolder.id),
      hidden: Boolean(tab.hidden),
      version: saved?.version ?? 0,
    };
  });
  const registerFileGuard = owner?.registerFileGuard;
  useEffect(() => {
    registerFileGuard?.(files.flushAll);
    return () => registerFileGuard?.(async () => true);
  }, [registerFileGuard, files.flushAll]);
  const apps = createDesktopApps({
    profile,
    pageTabs,
    pageFiles,
    firstTab,
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
      ...files.folders
        .filter((folder) => desktopFolder && folder.parentId === desktopFolder.id)
        .map((folder) => ({
          id: `folder-${folder.id}`,
          folderId: folder.id,
          title: folder.name,
          Icon: FolderIcon,
          color: 'yellow',
        })),
    ],
    desktopOrder?.scope === desktopScope ? desktopOrder.ids : (profile.desktopOrder ?? []),
  );
  const visibleIds = new Set(visibleApps.map((app) => app.id));
  const entries = desktopEntries(files.files, files.folders, pageFiles, canEdit);
  const commands = entryCommands(files, files.folders);
  const openFile = files.open;
  const restoreDocuments = useCallback(
    async (ids: string[]) => {
      const opened = await Promise.all(ids.map(async (id) => ((await openFile(id)) ? id : null)));
      return opened.filter((id): id is string => id !== null);
    },
    [openFile],
  );
  const { windows, dispatch, positions, setPosition, ready } = useDesktopSession({
    spaceId: profile.id,
    mode: canEdit ? 'owner' : 'visitor',
    initialState,
    availableIds: visibleApps.map((app) => app.id),
    metadataReady: !files.loading,
    metadataError: !!files.metadataError,
    restoreDocuments,
    enabled: !preview,
  });
  const active = ready ? windows.order.filter((id) => visibleIds.has(id)).at(-1) : undefined;
  const requestedApp = owner?.requestedApp?.id;
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
        setDesktopError('Could not save the desktop arrangement. Try again.');
      }
    } catch {
      setDesktopOrder({ scope: desktopScope, ids: current });
      setDesktopError('Could not save the desktop arrangement. Try again.');
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
    if (!canEdit || organizingRef.current || owner.busy) return;
    organizingRef.current = true;
    setOrganizing(true);
    setDesktopError('');
    try {
      const entry = findDesktopEntry(entries, item);
      if (entry) await commands.move(entry, folderId);
    } catch (error) {
      setDesktopError((error as Error).message);
    } finally {
      organizingRef.current = false;
      setOrganizing(false);
    }
  }
  const desktopDrop = drag.target(
    'desktop-folder',
    (item) => Boolean(desktopFolder && canMoveDesktopItem(item, desktopFolder.id)),
    // eslint-disable-next-line react-hooks/refs -- The adapter registers this drop handler; it runs only after an interaction.
    (item) => {
      if (desktopFolder) void moveDocument(item, desktopFolder.id);
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
    if (canEdit && owner.apps.some((app) => app.id === id) && !(await owner.openApp(id))) return;
    dispatch({ type: 'open', id });
    if (workspace.current && workspace.current.clientWidth <= 960)
      workspace.current.scrollTo({ top: 0 });
    const tab = layout.tabs.find((tab) => `tab-${tab.id}` === id);
    if (tab) {
      if (controlled) onSelectTab?.(tab.id);
      else {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', tab.slug);
        url.hash = '';
        if (url.href !== window.location.href) window.history.pushState(null, '', url);
      }
    }
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
    dockButtons.current.get(id)?.focus({ preventScroll: true });
  }

  async function resetDesktop() {
    if (canEdit && !(await owner.beforeHide('', false))) return;
    setColor(null);
    setFont(null);
    // Keep drawing and owner drafts mounted while restoring public window positions.
    setResetKey((key) => key + 1);
    dispatch({
      type: 'reset',
      firstTab: `tab-${firstTab.id}`,
      active: 'about',
      preserve: [
        'paint',
        'files',
        'text-editor',
        ...fileApps.map((app) => app.id),
        ...(owner?.apps.map((app) => app.id) ?? []),
      ],
    });
    dockButtons.current.get('about')?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!ready) return;
    if (controlled && selectedId && selectedId !== lastSelectedTab.current)
      dispatch({ type: 'open', id: `tab-${selectedId}` });
    lastSelectedTab.current = selectedId;
  }, [controlled, selectedId, ready, dispatch]);

  useEffect(() => {
    if (!ready || !requestedApp || !canEdit) return;
    const token = `${profile.id}:${requestedApp}:${requestKey}`;
    if (consumedRequest.current === token) return;
    consumedRequest.current = token;
    dispatch({ type: 'open', id: requestedApp === 'owner-profile' ? 'about' : requestedApp });
  }, [ready, requestedApp, requestKey, canEdit, profile.id, dispatch]);

  // Native tab URLs and item fragments keep working without remounting the desktop.
  useEffect(() => {
    if (controlled || !ready) return;
    let frame = 0;
    function readLocation(event?: Event) {
      const url = new URL(window.location.href);
      let tab = layout.tabs.find((tab) => tab.slug === url.searchParams.get('tab'));
      let fragment = '';
      try {
        fragment = decodeURIComponent(url.hash.slice(1));
      } catch {
        /* Ignore malformed fragments. */
      }
      if (fragment) {
        const item = profile.links.find(
          (item) =>
            [`widget-${item.id ?? item.slug}`, `interest-${item.id ?? item.slug}`].includes(
              fragment,
            ) ||
            item.collection?.items.some(
              (child) => `interest-${child.id ?? child.slug}` === fragment,
            ),
        );
        if (item)
          tab =
            layout.tabs.find((tab) =>
              getLayoutGroups(tab).some((group) => group.slugs.includes(item.slug)),
            ) ?? tab;
      }
      if (tab) dispatch({ type: 'open', id: `tab-${tab.id}` });
      else if (event) dispatch({ type: 'open', id: 'about' });
      if (fragment)
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() =>
            document.getElementById(fragment)?.scrollIntoView({ block: 'nearest' }),
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
  }, [layout, profile.links, controlled, ready, dispatch]);

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
      style={{ ...profileThemeStyle(theme), ...profileFontStyle(selectedFont) } as CSSProperties}
    >
      <div
        className={`desktop-workspace${active ? ' has-active-window' : ''}`}
        {...desktopDrop}
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
          drag={drag}
          busy={organizing || !!(canEdit && owner.busy)}
          onOpen={(id) => void openApp(id)}
          onReorder={(id, target) => void reorderDesktop(id, target)}
          canMoveToFolder={canMoveDesktopItem}
          onMoveToFolder={(item, folderId) => void moveDocument(item, folderId)}
          onUnpin={canEdit ? (id) => void moveDocument(desktopItem(id), null) : undefined}
        />
        {desktopDrop['data-drop-target'] && (
          <div className="desktop-drop-hint">{t('Move to Desktop')}</div>
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
              category={app.category}
              icon={<Icon weight="regular" aria-hidden="true" size={17} />}
              index={
                app.resource?.kind === 'file'
                  ? 4
                  : apps
                      .filter((item) => item.resource?.kind !== 'file')
                      .findIndex((item) => item.id === id)
              }
              className={app.windowClassName}
              keepMounted={app.keepMounted}
              open={ready && visibleIds.has(id) && windows.order.includes(id)}
              active={active === id}
              maximized={windows.maximized.includes(id)}
              layer={windows.order.indexOf(id)}
              workspace={workspace}
              onFocus={() => dispatch({ type: 'open', id })}
              onHide={() => void hideApp(id, true)}
              onMinimize={() => void hideApp(id)}
              onMaximize={() => dispatch({ type: 'maximize', id })}
            >
              {app.render(active === id)}
            </DesktopWindow>
          );
        })}
        {owner?.notification}
      </div>
      <footer className="desktop-taskbar" aria-label={t('Taskbar')}>
        <DesktopStartMenu
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
          aria-label={t('Show desktop')}
          title={t('Show desktop')}
        >
          <SquaresFourIcon weight="regular" aria-hidden="true" size={21} />
        </button>
        <nav className="desktop-dock" aria-label={t('Open apps')}>
          {visibleApps
            .filter((app) => ready && windows.running.includes(app.id))
            .map(({ id, title, Icon }) => (
              <button
                type="button"
                key={id}
                ref={(node) => {
                  if (node) dockButtons.current.set(id, node);
                  else dockButtons.current.delete(id);
                }}
                onClick={() => (active === id ? void hideApp(id) : void openApp(id))}
                aria-label={title}
                aria-pressed={active === id}
                aria-controls={`desktop-${id}`}
                className={windows.order.includes(id) ? 'is-open' : ''}
                title={title}
              >
                <Icon weight="regular" aria-hidden="true" size={19} />
                <span>{title}</span>
              </button>
            ))}
        </nav>
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
