'use client';

import { lazy, Suspense } from 'react';
import { ProfileSettings } from './profile-settings';
import { DomainSettings } from './domain-settings';
import { BillingSettings } from './billing-settings';
import { FeedbackApp } from './feedback-app';
import { SupportApp } from './support-app';
import { MetricsPanel } from './metrics-panel';
import { HistoryPanel } from './history-panel';
import type { ActiveWorkspace } from './use-workspace';
import type { DesktopApp } from './apps';

const LocalDomainSettings =
  process.env.NEXT_PUBLIC_LOCAL_DOMAIN_MOCK === 'true'
    ? lazy(() => import('./local-domain-settings'))
    : null;

export function AppContent({
  app,
  workspace,
  onOpenAssistance,
}: {
  app: Exclude<DesktopApp, 'help' | 'chatgpt'>;
  workspace: ActiveWorkspace;
  onOpenAssistance: (section: 'help' | 'feedback' | 'support' | 'billing') => void;
}) {
  const { profile } = workspace;
  switch (app) {
    case 'profile':
      return <ProfileSettings workspace={workspace} showThemePicker={false} />;
    case 'domains':
      if (LocalDomainSettings) {
        return (
          <Suspense fallback={null}>
            <LocalDomainSettings
              key={profile.id}
              profile={profile}
              plan={workspace.plan}
              onExplorePremium={() => workspace.selectSection('billing')}
            />
          </Suspense>
        );
      }
      return (
        <DomainSettings
          key={profile.id}
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
      return <FeedbackApp spaceId={profile.id} onOpenSupport={() => onOpenAssistance('support')} />;
    case 'support':
      return (
        <SupportApp
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
