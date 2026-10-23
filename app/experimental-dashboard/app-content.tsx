'use client';

import { useTranslation } from '../components/language-provider';
import { CatalogCredit } from '../components/catalog-credit';
import { WorkspaceLinks } from '../dashboard/workspace-links';
import { ProfileSettings } from '../dashboard/profile-settings';
import { DomainSettings } from '../dashboard/domain-settings';
import { MetricsPanel } from '../dashboard/metrics-panel';
import { HistoryPanel } from '../dashboard/history-panel';
import { ChatGPTPanel } from '../dashboard/chatgpt-panel';
import { AddItemMenu } from '../dashboard/add-item-menu';
import type { ActiveWorkspace } from '../dashboard/use-workspace';
import type { ContentClipboard } from '../dashboard/use-content-clipboard';
import type { DesktopApp } from './apps';

export function AppContent({
  app,
  workspace,
  clipboard,
  standalone,
}: {
  app: DesktopApp;
  workspace: ActiveWorkspace;
  clipboard: ContentClipboard;
  standalone: boolean;
}) {
  const { t } = useTranslation();
  const { profile } = workspace;
  switch (app) {
    case 'links':
      return (
        <>
          <div className="os-links-toolbar">
            <div>
              <h3>{t('Everywhere you are.')}</h3>
              <p>{t('Your world, one link at a time.')}</p>
            </div>
            <AddItemMenu
              openInWindow
              buttonRef={workspace.addLinkButton}
              busy={workspace.busy}
              contentDisabled={workspace.newProfileTab}
              sectionDisabled={
                workspace.profileLayout.tabs.reduce(
                  (count, tab) => count + tab.sections.length,
                  0,
                ) >= 20
              }
              onPaste={() => void clipboard.openPaste()}
              onAdd={(kind) => {
                workspace.addLinkButton.current?.focus({ preventScroll: true });
                workspace.edit(kind);
              }}
              onSection={() =>
                workspace.changeLayout({
                  ...workspace.layout,
                  sections: [
                    ...workspace.layout.sections,
                    { id: crypto.randomUUID(), title: 'New section', slugs: [] },
                  ],
                })
              }
            />
          </div>
          <WorkspaceLinks workspace={workspace} clipboard={clipboard} inlineEditors={false} />
          <CatalogCredit />
        </>
      );
    case 'profile':
      return <ProfileSettings workspace={workspace} showThemePicker={false} />;
    case 'domains':
      return (
        <DomainSettings
          profile={profile}
          onChanged={(publicDomain) =>
            workspace.setProfile((current) =>
              current?.id === profile.id ? { ...current, publicDomain } : current,
            )
          }
        />
      );
    case 'metrics':
      return <MetricsPanel spaceId={profile.id} />;
    case 'history':
      return <HistoryPanel workspace={workspace} />;
    case 'chatgpt':
      return <ChatGPTPanel standalone={standalone} handle={profile.handle} />;
  }
}
