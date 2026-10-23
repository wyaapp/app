'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { EyeIcon } from '@phosphor-icons/react/dist/ssr/Eye';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/ssr/SlidersHorizontal';
import { useTranslation } from '../components/language-provider';
import { BrandSpark } from '../components/brand-spark';
import { DesktopProfile } from '../components/desktop-profile/desktop-profile';
import {
  useWorkspace,
  type WorkspaceProps,
  type ActiveWorkspace,
} from '../dashboard/use-workspace';
import { useContentClipboard, type ContentClipboard } from '../dashboard/use-content-clipboard';
import { ContentClipboardDialog } from '../dashboard/content-clipboard-dialog';
import { CreateSpace } from '../dashboard/space-controls';
import { OnboardingScreen } from '../dashboard/onboarding-screen';
import { visibleProfile } from '@/lib/public-profile';
import { allItems } from '@/lib/collections';
import { ItemEditor } from '../dashboard/item-editor';
import { AddItemMenu } from '../dashboard/add-item-menu';
import { desktopApps } from './apps';
import { OwnerMenu, SpaceMenu } from './start-menu';
import { AppContent } from './app-content';

export default function ExperimentalDashboard(props: WorkspaceProps) {
  const { t } = useTranslation();
  const workspace = useWorkspace(props, {
    base: '/experimental-dashboard',
    keepEditorsMounted: true,
  });
  const clipboard = useContentClipboard(workspace);
  if (!workspace.profile || workspace.creating || !workspace.onboarding)
    return (
      <div className="os-setup" onClickCapture={workspace.navigateFromEditor}>
        <div className="os-setup-brand">
          <BrandSpark />
          <strong>wya.im</strong>
          <span>{t('Experimental')}</span>
        </div>
        {workspace.error && (
          <p className="message error" role="alert">
            {t(workspace.error)}
          </p>
        )}
        {!workspace.profile || workspace.creating ? (
          <CreateSpace
            count={workspace.spaces.length}
            busy={workspace.busy}
            displayName={props.displayName}
            onSave={workspace.save}
            onCancel={workspace.profile ? () => workspace.setCreating(false) : undefined}
          />
        ) : (
          <OnboardingScreen onSaved={workspace.setOnboarding} />
        )}
        <a className="text-link" href={props.signOut} target="_top">
          {t('Sign out')}
        </a>
      </div>
    );
  return (
    <DesktopSession
      key={workspace.profile.id}
      workspace={{ ...workspace, profile: workspace.profile }}
      clipboard={clipboard}
      signOut={props.signOut}
      standalone={props.standalone}
    />
  );
}

function DesktopSession({
  workspace,
  clipboard,
  signOut,
  standalone,
}: {
  workspace: ActiveWorkspace;
  clipboard: ContentClipboard;
  signOut: string;
  standalone: boolean;
}) {
  const { t } = useTranslation();
  const [visitor, setVisitor] = useState(false);
  const fileGuard = useRef<() => Promise<boolean>>(async () => true);
  const registerFileGuard = useCallback((guard: () => Promise<boolean>) => {
    fileGuard.current = guard;
  }, []);
  const [requestedApp, requestApp] = useReducer(
    (current: { id: string; sequence: number } | undefined, id: string) => ({
      id,
      sequence: (current?.sequence ?? 0) + 1,
    }),
    workspace.tab === 'links' ? undefined : { id: `owner-${workspace.tab}`, sequence: 0 },
  );
  const previousSection = useRef(workspace.tab);
  const editingId =
    typeof workspace.editing === 'string'
      ? workspace.editing
      : (workspace.editing?.id ?? workspace.editing?.slug);
  const disabled = workspace.busy && !workspace.autosaving;
  const profile = visitor ? visibleProfile(workspace.profile) : workspace.previewProfile!;

  // Direct routes and browser history select management windows; /links starts on the page.
  useEffect(() => {
    if (previousSection.current !== workspace.tab) requestApp(`owner-${workspace.tab}`);
    previousSection.current = workspace.tab;
  }, [workspace.tab]);
  useEffect(() => {
    if (editingId) requestApp('owner-entry');
  }, [editingId]);

  async function openApp(id: string) {
    if (disabled || visitor) return false;
    const section = desktopApps.find((app) => `owner-${app.id}` === id)?.id;
    return !section || section === workspace.tab || (await workspace.selectSection(section));
  }

  async function beforeHide(id: string, close: boolean) {
    if (!(await fileGuard.current())) return false;
    if (disabled || !(await workspace.finishEntry())) return false;
    if (id === 'owner-entry' && close) await workspace.closeEditor();
    return true;
  }

  return (
    <div className="experimental-dashboard" onClickCapture={workspace.navigateFromEditor}>
      <ContentClipboardDialog workspace={workspace} clipboard={clipboard} />
      <aside
        className={`os-view-controls ${visitor ? 'is-preview' : ''}`}
        aria-label={t('Viewing mode')}
      >
        <span>
          <strong>{t(visitor ? 'Visitor preview' : 'Editing')}</strong>
          <small>@{workspace.profile.handle}</small>
        </span>
        <button
          type="button"
          className="os-preview-toggle"
          aria-label={t(visitor ? 'Back to editing' : 'View as visitor')}
          title={t(visitor ? 'Back to editing' : 'View as visitor')}
          aria-pressed={visitor}
          disabled={disabled}
          onClick={async () => {
            if (!(await beforeHide('', false))) return;
            setVisitor((current) => !current);
          }}
        >
          {visitor ? (
            <PencilSimpleIcon weight="regular" aria-hidden="true" size={18} />
          ) : (
            <EyeIcon weight="regular" aria-hidden="true" size={18} />
          )}
          <span>{t(visitor ? 'Back to editing' : 'Preview')}</span>
        </button>
      </aside>
      <DesktopProfile
        profile={profile}
        selectedTab={workspace.activeProfileTab.id}
        owner={{
          visitor,
          busy: workspace.busy,
          saveAppearance: async (change) => {
            if (visitor || !(await beforeHide('', false))) return false;
            return workspace.save({ action: 'update_profile', ...change });
          },
          saveDesktopOrder: async (desktopOrder) => {
            if (visitor || !(await beforeHide('', false))) return false;
            return workspace.save({ action: 'update_profile', desktopOrder });
          },
          requestedApp,
          openApp,
          beforeHide,
          registerFileGuard,
          profileEditor: (
            <AppContent
              app="profile"
              workspace={workspace}
              clipboard={clipboard}
              standalone={standalone}
            />
          ),
          editItem: async (item, tab) => {
            if (!(await beforeHide('', false))) return;
            await workspace.selectProfileTab(tab.id);
            await workspace.edit(item, false);
            requestApp('owner-entry');
          },
          tabActions: (tab) => (
            <>
              {tab.hidden && <span className="desktop-hidden-label">{t('Hidden tab')}</span>}
              <button
                type="button"
                className="desktop-edit-button"
                disabled={disabled}
                onClick={async () => {
                  if (!(await beforeHide('', false))) return;
                  await workspace.selectProfileTab(tab.id);
                  await workspace.selectSection('links');
                  requestApp('owner-links');
                }}
              >
                <SlidersHorizontalIcon weight="regular" aria-hidden="true" size={15} />
                {t('Manage content')}
              </button>
              <AddItemMenu
                buttonRef={null}
                busy={disabled}
                contentDisabled={workspace.newProfileTab}
                sectionDisabled={
                  disabled ||
                  workspace.profileLayout.tabs.reduce(
                    (count, tab) => count + tab.sections.length,
                    0,
                  ) >= 20
                }
                onSection={async () => {
                  if (!(await beforeHide('', false))) return;
                  await workspace.selectProfileTab(tab.id);
                  workspace.changeProfileLayout({
                    ...workspace.profileLayout,
                    tabs: workspace.profileLayout.tabs.map((current) =>
                      current.id === tab.id
                        ? {
                            ...current,
                            sections: [
                              ...current.sections,
                              { id: crypto.randomUUID(), title: t('New section'), slugs: [] },
                            ],
                          }
                        : current,
                    ),
                  });
                  await workspace.selectSection('links');
                  requestApp('owner-links');
                }}
                onPaste={async () => {
                  if (await beforeHide('', false)) {
                    await workspace.selectProfileTab(tab.id);
                    await clipboard.openPaste();
                  }
                }}
                onAdd={async (kind) => {
                  if (await beforeHide('', false)) {
                    await workspace.selectProfileTab(tab.id);
                    await workspace.edit(kind, false);
                    requestApp('owner-entry');
                  }
                }}
              />
            </>
          ),
          apps: [
            ...desktopApps
              .filter((app) => app.id !== 'profile')
              .map(({ id, label, icon: Icon, color, category, shortcut }) => ({
                id: `owner-${id}`,
                title: t(label),
                Icon,
                color,
                category,
                shortcut,
                content: (
                  <AppContent
                    app={id}
                    workspace={workspace}
                    clipboard={clipboard}
                    standalone={standalone}
                  />
                ),
              })),
            ...(workspace.editing
              ? [
                  {
                    id: 'owner-entry',
                    title: t(typeof workspace.editing === 'string' ? 'Add item' : 'Edit item'),
                    Icon: PencilSimpleIcon,
                    color: 'yellow',
                    category: 'apps' as const,
                    launcher: false,
                    content: (
                      <ItemEditor
                        key={
                          typeof workspace.editing === 'string'
                            ? workspace.editing
                            : (workspace.editing.id ?? workspace.editing.slug)
                        }
                        item={workspace.editing}
                        handle={workspace.profile.handle}
                        existingSlugs={allItems(workspace.profile.links).flatMap((item) => [
                          item.slug,
                          ...(item.aliases ?? []),
                        ])}
                        busy={disabled}
                        registerAutosave={workspace.registerAutosave}
                        onSave={(data) =>
                          workspace.save(data, typeof workspace.editing === 'object')
                        }
                        onClose={workspace.closeEditor}
                      />
                    ),
                  },
                ]
              : []),
          ],
          menuFooter: (
            <OwnerMenu
              workspace={workspace}
              signOut={signOut}
              standalone={standalone}
              beforeLeave={() => beforeHide('', false)}
            />
          ),
          taskbar: !visitor && (
            <SpaceMenu workspace={workspace} compact beforeLeave={() => beforeHide('', false)} />
          ),
          notification: (workspace.error || (!visitor && workspace.notice)) && (
            <div
              className={`os-notification ${workspace.error ? 'is-error' : ''}`}
              role={workspace.error ? 'alert' : 'status'}
            >
              {!workspace.error && <CheckIcon weight="regular" aria-hidden="true" size={18} />}
              <span>{t(workspace.error || workspace.notice)}</span>
              <button
                type="button"
                aria-label={t('Dismiss notification')}
                onClick={() => {
                  workspace.setError('');
                  workspace.setNotice('');
                }}
              >
                <XIcon weight="regular" aria-hidden="true" size={17} />
              </button>
            </div>
          ),
        }}
      />
    </div>
  );
}
