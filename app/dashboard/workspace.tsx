'use client';

import { lazy, Suspense, useCallback, useRef } from 'react';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { useTranslation } from '../components/language-provider';
import { Brand } from '../components/brand';
import { LanguageSwitcher } from '../components/language-switcher';
import { useWorkspace, type WorkspaceProps, type ActiveWorkspace } from './use-workspace';
import { CreateSpace } from './space-controls';
import { OnboardingScreen } from './onboarding-screen';
import { SpaceSwitcher } from './space-switcher';
import { AppContent } from './app-content';
import { dashboardHref, type DashboardSection } from '@/lib/dashboard-routes';
import { spaceAddress } from '@/lib/public-address';

const Files = lazy(() => import('./content-files'));
const Layout = lazy(() => import('./page-layout'));
const Help = lazy(() => import('./help'));
const sections: { id: DashboardSection; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'profile', label: 'Bio' },
  { id: 'layout', label: 'Page layout' },
  { id: 'domains', label: 'Custom domain' },
  { id: 'billing', label: 'Plans & billing' },
  { id: 'metrics', label: 'Analytics' },
  { id: 'history', label: 'Change history' },
  { id: 'help', label: 'Help' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'support', label: 'Support' },
];
import type { RegisterNavigationGuard } from '@/lib/navigation-guard';

export default function Dashboard(props: WorkspaceProps) {
  const { t } = useTranslation();
  const guards = useRef(new Map<string, () => Promise<boolean>>());
  const registerGuard = useCallback<RegisterNavigationGuard>((id, guard) => {
    guards.current.set(id, guard);
    return () => {
      guards.current.delete(id);
    };
  }, []);
  const beforeNavigate = useCallback(async () => {
    for (const guard of guards.current.values()) if (!(await guard())) return false;
    return true;
  }, []);
  const workspace = useWorkspace(props, { beforeNavigate });
  const active = workspace.profile ? { ...workspace, profile: workspace.profile } : null;
  const setup = !active || workspace.creating || !workspace.onboarding;
  const section = workspace.tab;
  return (
    <div className="simple-dashboard" onClickCapture={workspace.navigateFromEditor}>
      <a className="dashboard-skip" href="#dashboard-main">
        {t('Skip to content')}
      </a>
      <header className="dashboard-topbar">
        <Brand />
        <div className="dashboard-account">
          <LanguageSwitcher />
          <a className="text-link" href={props.signOut} target="_top">
            {t('Sign out')}
          </a>
        </div>
      </header>
      {active && !setup && (
        <>
          <div className="dashboard-spacebar">
            <SpaceSwitcher workspace={active} />
            <a
              className="button button-light button-small"
              href={spaceAddress(active.profile)}
              target="_blank"
              rel="noreferrer"
            >
              {t('View your space')}
              <ArrowUpRightIcon size={18} aria-hidden="true" />
            </a>
          </div>
          <nav className="dashboard-navigation" aria-label={t('Dashboard')}>
            {sections.map((item) => (
              <a
                key={item.id}
                href={dashboardHref(item.id, active.profile.id)}
                aria-current={section === item.id ? 'page' : undefined}
              >
                {t(item.label)}
              </a>
            ))}
          </nav>
        </>
      )}
      <main id="dashboard-main" className="dashboard-content" tabIndex={-1}>
        {workspace.error && (
          <p className="dashboard-message error" role="alert">
            {t(workspace.error)}
          </p>
        )}
        {workspace.notice && (
          <p className="dashboard-message" role="status">
            {t(workspace.notice)}
          </p>
        )}
        {setup ? (
          <div className="dashboard-panel">
            {!active || workspace.creating ? (
              <CreateSpace
                count={workspace.spaces.length}
                plan={workspace.plan}
                busy={workspace.busy}
                displayName={props.displayName}
                onSave={workspace.save}
                onCancel={active ? () => workspace.setCreating(false) : undefined}
                onExplorePremium={async () => {
                  if (await workspace.selectSection('billing')) workspace.setCreating(false);
                }}
              />
            ) : (
              <OnboardingScreen onSaved={workspace.setOnboarding} />
            )}
          </div>
        ) : (
          <>
            <h1 className="dashboard-heading">
              {t(sections.find((item) => item.id === section)?.label ?? 'Files')}
            </h1>
            <Suspense
              fallback={
                <p className="dashboard-panel" role="status">
                  {t('Loading…')}
                </p>
              }
            >
              <DashboardSection
                key={`${active.profile.id}:${section}`}
                section={section}
                workspace={active}
                registerGuard={registerGuard}
                standalone={props.standalone}
              />
            </Suspense>
          </>
        )}
      </main>
    </div>
  );
}
function DashboardSection({
  section,
  workspace,
  registerGuard,
  standalone,
}: {
  section: DashboardSection;
  workspace: ActiveWorkspace;
  registerGuard: RegisterNavigationGuard;
  standalone: boolean;
}) {
  if (section === 'files') return <Files workspace={workspace} registerGuard={registerGuard} />;
  if (section === 'layout') return <Layout workspace={workspace} registerGuard={registerGuard} />;
  if (section === 'help')
    return (
      <div className="dashboard-panel">
        <Help standalone={standalone} handle={workspace.profile.handle} />
      </div>
    );
  return (
    <div className="dashboard-panel">
      <AppContent
        app={section}
        workspace={workspace}
        onOpenAssistance={(section) => void workspace.selectSection(section)}
      />
    </div>
  );
}
