'use client';

import { lazy, Suspense } from 'react';
const ProfileSettings = lazy(() =>
  import('./profile-settings').then((module) => ({ default: module.ProfileSettings })),
);
const DomainSettings = lazy(() =>
  import('./domain-settings').then((module) => ({ default: module.DomainSettings })),
);
const BillingSettings = lazy(() =>
  import('./billing-settings').then((module) => ({ default: module.BillingSettings })),
);
const FeedbackApp = lazy(() =>
  import('./feedback-app').then((module) => ({ default: module.FeedbackApp })),
);
const SupportApp = lazy(() =>
  import('./support-app').then((module) => ({ default: module.SupportApp })),
);
const MetricsPanel = lazy(() =>
  import('./metrics-panel').then((module) => ({ default: module.MetricsPanel })),
);
const HistoryPanel = lazy(() =>
  import('./history-panel').then((module) => ({ default: module.HistoryPanel })),
);
import type { ActiveWorkspace } from './use-workspace';
import type { DashboardSection } from '@/lib/dashboard-routes';

const LocalDomainSettings =
  process.env.NEXT_PUBLIC_LOCAL_DOMAIN_MOCK === 'true'
    ? lazy(() => import('./local-domain-settings'))
    : null;

export function AppContent({
  app,
  workspace,
  onOpenAssistance,
}: {
  app: Exclude<DashboardSection, 'help' | 'chatgpt' | 'files' | 'links' | 'layout'>;
  workspace: ActiveWorkspace;
  onOpenAssistance: (section: 'help' | 'feedback' | 'support' | 'billing') => void;
}) {
  const { profile } = workspace;
  switch (app) {
    case 'profile':
      return <ProfileSettings workspace={workspace} />;
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
