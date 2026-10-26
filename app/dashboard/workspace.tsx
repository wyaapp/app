'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { EyeIcon } from '@phosphor-icons/react/dist/ssr/Eye';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/ssr/SlidersHorizontal';
import { QuestionIcon } from '@phosphor-icons/react/dist/ssr/Question';
import { useTranslation } from '../components/language-provider';
import { BrandSpark } from '../components/brand-spark';
import { DesktopProfile } from '../components/desktop-profile/desktop-profile';
import { useWorkspace, type WorkspaceProps, type ActiveWorkspace } from './use-workspace';
import { useContentClipboard, type ContentClipboard } from './use-content-clipboard';
import { ContentClipboardDialog } from './content-clipboard-dialog';
import { CreateSpace } from './space-controls';
import { OnboardingScreen } from './onboarding-screen';
import { visibleProfile } from '@/lib/public-profile';
import { allItems } from '@/lib/collections';
import { ItemEditor, itemEditorTitle } from './item-editor';
import { HelpApp, type HelpGuideRequest } from '../components/desktop-profile/help-app';
import { dashboardWindowId } from '@/lib/dashboard-routes';
import { AddItemMenu } from './add-item-menu';
import { desktopApps } from './apps';
import { OwnerMenu, SpaceMenu } from './start-menu';
import { AppContent } from './app-content';

export default function Dashboard(props: WorkspaceProps) {
  const { t } = useTranslation();
  const workspace = useWorkspace(props, {
    keepEditorsMounted: true,
  });
  const clipboard = useContentClipboard(workspace);
  if (!workspace.profile || workspace.creating || !workspace.onboarding)
    return (
      <div className="os-setup" onClickCapture={workspace.navigateFromEditor}>
        <div className="os-setup-brand">
          <BrandSpark />
          <strong>wya.im</strong>
        </div>
        {workspace.error && (
          <p className="message error" role="alert">
            {t(workspace.error)}
          </p>
        )}
        {!workspace.profile || workspace.creating ? (
          <CreateSpace
            count={workspace.spaces.length}
            plan={workspace.plan}
            busy={workspace.busy}
            displayName={props.displayName}
            onSave={workspace.save}
            onCancel={workspace.profile ? () => workspace.setCreating(false) : undefined}
            onExplorePremium={async () => {
              if (await workspace.selectSection('billing')) workspace.setCreating(false);
            }}
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
  const [helpRequest, setHelpRequest] = useState<HelpGuideRequest | undefined>(() =>
    workspace.tab === 'chatgpt' ? { id: 'chatgpt', sequence: 0 } : undefined,
  );
  const fileGuard = useRef<() => Promise<boolean>>(async () => true);
  const documentGuards = useRef(new Map<string, () => Promise<boolean>>());
  const registerFileGuard = useCallback((guard: () => Promise<boolean>) => {
    fileGuard.current = guard;
  }, []);
  const registerDocumentGuard = useCallback((id: string, guard: () => Promise<boolean>) => {
    documentGuards.current.set(id, guard);
    return () => {
      documentGuards.current.delete(id);
    };
  }, []);
  const [requestedApp, requestApp] = useReducer(
    (current: { id: string; sequence: number } | undefined, id: string) => ({
      id,
      sequence: (current?.sequence ?? 0) + 1,
    }),
    workspace.tab === 'links' ? undefined : { id: dashboardWindowId(workspace.tab), sequence: 0 },
  );
  const [previousSection, setPreviousSection] = useState(workspace.tab);
  // Select the destination before rendering, including history and old ChatGPT routes.
  if (previousSection !== workspace.tab) {
    setPreviousSection(workspace.tab);
    requestApp(dashboardWindowId(workspace.tab));
    if (workspace.tab === 'chatgpt' || workspace.tab === 'help')
      setHelpRequest((current) => ({
        id: workspace.tab === 'chatgpt' ? 'chatgpt' : null,
        sequence: (current?.sequence ?? 0) + 1,
      }));
  }
  const editingId =
    typeof workspace.editing === 'string'
      ? workspace.editing
      : (workspace.editing?.id ?? workspace.editing?.slug);
  const disabled = workspace.busy && !workspace.autosaving;
  const profile = visitor ? visibleProfile(workspace.profile) : workspace.previewProfile!;
  const editingDiscord =
    workspace.editing === 'new-discord' ||
    (typeof workspace.editing === 'object' && workspace.editing?.kind === 'discord');

  function openDiscordHelp() {
    setHelpRequest((current) => ({ id: 'discord-widget', sequence: (current?.sequence ?? 0) + 1 }));
    requestApp('owner-help');
  }

  function returnToDiscordEditor() {
    requestApp('owner-entry');
  }

  async function openAssistance(section: 'help' | 'feedback' | 'support' | 'billing') {
    if (section === 'billing' && !(await workspace.selectSection(section))) return;
    if (section === 'help')
      setHelpRequest((current) => ({ id: null, sequence: (current?.sequence ?? 0) + 1 }));
    requestApp(dashboardWindowId(section));
  }

  useEffect(() => {
    if (editingId) requestApp('owner-entry');
  }, [editingId]);

  async function openApp(id: string) {
    if (disabled || visitor) return false;
    if (id === 'owner-help') {
      setHelpRequest((current) => ({ id: null, sequence: (current?.sequence ?? 0) + 1 }));
      return true;
    }
    if (id === 'owner-support' || id === 'owner-feedback') return true;
    const section = desktopApps.find((app) => `owner-${app.id}` === id)?.id;
    return !section || section === workspace.tab || (await workspace.selectSection(section));
  }

  async function beforeHide(id: string, close: boolean) {
    // Assistance must stay available while an unrelated editor is unfinished.
    if (id === 'owner-help' || id === 'owner-support' || id === 'owner-feedback') return true;
    for (const guard of documentGuards.current.values()) if (!(await guard())) return false;
    if (!(await fileGuard.current())) return false;
    if (disabled) return false;
    if (id === 'owner-entry' && close) return workspace.closeEditor();
    return workspace.finishEntry();
  }

  return (
    <div className="desktop-dashboard" onClickCapture={workspace.navigateFromEditor}>
      <ContentClipboardDialog workspace={workspace} clipboard={clipboard} />
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
          registerDocumentGuard,
          publishDocument: async (tabId, source, expectedVersion, appearance) => {
            if (visitor || disabled || !(await workspace.finishEntry())) return false;
            if (workspace.layoutChanged) {
              workspace.setError('Save or discard layout changes before publishing a document.');
              return false;
            }
            return workspace.save({
              action: 'publish_document',
              tabId,
              source,
              expectedVersion,
              appearance,
            });
          },
          profileEditor: (
            <AppContent
              app="profile"
              workspace={workspace}
              clipboard={clipboard}
              onOpenAssistance={openAssistance}
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
                openInWindow
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
              .filter((app) => app.id !== 'profile' && app.id !== 'help')
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
                    onOpenAssistance={openAssistance}
                  />
                ),
              })),
            {
              id: 'owner-help',
              title: t('Help'),
              Icon: QuestionIcon,
              color: 'sky',
              category: 'guides',
              shortcut: false,
              windowClassName: 'desktop-management-window desktop-help-window',
              content: (
                <HelpApp
                  standalone={standalone}
                  handle={profile.handle}
                  requestedGuide={helpRequest}
                  onReturnToEditor={editingDiscord ? returnToDiscordEditor : undefined}
                />
              ),
            },
            ...(workspace.editing
              ? [
                  {
                    id: 'owner-entry',
                    title: t(itemEditorTitle(workspace.editing)),
                    Icon: PencilSimpleIcon,
                    color: 'yellow',
                    category: 'apps' as const,
                    launcher: false,
                    pinnable: false,
                    windowClassName: 'desktop-management-window desktop-item-window',
                    content: (
                      <ItemEditor
                        presentation="window"
                        onOpenSetupGuide={openDiscordHelp}
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
          taskbar: (
            <div className="os-taskbar-controls" role="group" aria-label={t('Viewing mode')}>
              {visitor ? (
                <span className="os-preview-status">
                  <small>{t('Visitor preview')}</small>
                  <strong>@{workspace.profile.handle}</strong>
                </span>
              ) : (
                <SpaceMenu
                  workspace={workspace}
                  compact
                  beforeLeave={() => beforeHide('', false)}
                />
              )}
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
                  <PencilSimpleIcon weight="regular" aria-hidden="true" size={19} />
                ) : (
                  <EyeIcon weight="regular" aria-hidden="true" size={19} />
                )}
                <span>{t(visitor ? 'Back to editing' : 'Preview')}</span>
              </button>
            </div>
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
