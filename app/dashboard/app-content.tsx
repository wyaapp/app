'use client';

import { useTranslation } from '../components/language-provider';
import { CatalogCredit } from '../components/catalog-credit';
import { WorkspaceLinks } from './workspace-links';
import { ProfileSettings } from './profile-settings';
import { DomainSettings } from './domain-settings';
import { BillingSettings } from './billing-settings';
import { FeedbackApp } from './feedback-app';
import { SupportApp } from './support-app';
import { MetricsPanel } from './metrics-panel';
import { HistoryPanel } from './history-panel';
import { AddItemMenu } from './add-item-menu';
import type { ActiveWorkspace } from './use-workspace';
import type { ContentClipboard } from './use-content-clipboard';
import type { DesktopApp } from './apps';

export function AppContent({
  app,
  workspace,
  clipboard,
  onOpenAssistance,
}: {
  app: Exclude<DesktopApp, 'help' | 'chatgpt'>;
  workspace: ActiveWorkspace;
  clipboard: ContentClipboard;
  onOpenAssistance: (section: 'help' | 'feedback' | 'support' | 'billing') => void;
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
          plan={workspace.plan}
          onExplorePremium={() => workspace.selectSection('billing')}
          onChanged={(publicDomain) =>
            workspace.setProfile((current) =>
              current?.id === profile.id ? { ...current, publicDomain } : current,
            )
          }
        />
      );
    case 'billing':
      return <BillingSettings workspace={workspace} />;
    case 'feedback':
      return <FeedbackApp onOpenSupport={() => onOpenAssistance('support')} />;
    case 'support':
      return (
        <SupportApp
          spaceId={profile.id}
          onOpenHelp={() => onOpenAssistance('help')}
          onOpenBilling={() => onOpenAssistance('billing')}
        />
      );
    case 'metrics':
      return <MetricsPanel spaceId={profile.id} />;
    case 'history':
      return <HistoryPanel workspace={workspace} />;
  }
}
