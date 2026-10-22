'use client';
import { spaceAddress } from '@/lib/public-address';
import { useTranslation } from '@/app/components/language-provider';

import { LanguageSwitcher } from '../components/language-switcher';
import Link from 'next/link';
import { OnboardingScreen } from './onboarding-screen';
import { SiteFooter } from '../components/site-footer';
import {
  BarChart3,
  ArrowUpRight,
  Check,
  Sparkles,
  History,
  Link2,
  UserRound,
  Globe,
  Plug,
} from 'lucide-react';
import { MetricsPanel } from './metrics-panel';
import { Brand } from '../components/brand';
import { BrandSpark } from '../components/brand-spark';
import { ProfileCard } from '../components/profile-card';
import { DesktopProfile } from '../components/desktop-profile/desktop-profile';
import { AddItemMenu } from './add-item-menu';
import { CatalogCredit } from '../components/catalog-credit';
import { CreateSpace } from './space-controls';
import { SpaceSwitcher } from './space-switcher';
import { useWorkspace, type WorkspaceProps } from './use-workspace';
import { useContentClipboard } from './use-content-clipboard';
import { ContentClipboardDialog } from './content-clipboard-dialog';
import { WorkspaceLinks } from './workspace-links';
import { ProfileSettings } from './profile-settings';
import { DomainSettings } from './domain-settings';
import { HistoryPanel } from './history-panel';
import { ChatGPTPanel } from './chatgpt-panel';
import { dashboardHref } from '@/lib/dashboard-routes';

export default function Dashboard(props: WorkspaceProps) {
  const { t } = useTranslation();
  const { displayName, signOut, standalone } = props;
  const workspace = useWorkspace(props);
  const clipboard = useContentClipboard(workspace);
  const {
    profile,
    spaces,
    creating,
    setCreating,
    tab,
    busy,
    error,
    notice,
    editing,
    navigateFromEditor,
    addLinkButton,
    profileLayout,
    activeProfileTab,
    layout,
    newProfileTab,
    previewProfile,
    layoutChanged,
    selectProfileTab,
    changeLayout,
    save,
    edit,
  } = workspace;
  const alerts = (
    <div className="messages" aria-live="polite">
      {error && !(editing && typeof editing === 'object') && (
        <div className="message error" role="alert">
          {t(error)}
        </div>
      )}
      {notice && (
        <div className="message success">
          <Check size={16} />
          {t(notice)}
        </div>
      )}
    </div>
  );
  if (!profile || creating)
    return (
      <div className="site-shell page-with-footer">
        <header className="site-header">
          <Brand />
          <LanguageSwitcher />
          <a className="text-link" href={signOut} target="_top">
            {t('Sign out')}
          </a>
        </header>
        <div className="creation-messages">{alerts}</div>
        <CreateSpace
          count={spaces.length}
          busy={busy}
          displayName={displayName}
          onSave={save}
          onCancel={profile ? () => setCreating(false) : undefined}
        />
        <SiteFooter feedback />
      </div>
    );

  if (!workspace.onboarding) {
    return (
      <div className="onboarding-shell">
        <header className="site-header">
          <Brand />
          <LanguageSwitcher />
          <a className="text-link" href={signOut} target="_top">
            {t('Sign out')}
          </a>
        </header>
        <OnboardingScreen onSaved={workspace.setOnboarding} />
      </div>
    );
  }

  const activeWorkspace = { ...workspace, profile };
  return (
    <div className="workspace-shell" onClickCapture={navigateFromEditor}>
      <header className="workspace-header">
        <div className="workspace-header-inner">
          <Brand />
          <SpaceSwitcher workspace={activeWorkspace} />
          <div className="workspace-header-right">
            <LanguageSwitcher />
            <a
              href={profile.publicDomain ? spaceAddress(profile) : `/${profile.handle}`}
              target="_blank"
              rel="noreferrer"
              className="text-link workspace-header-link"
              aria-label={t('Visit your page')}
            >
              <span>{t('Visit your page')}</span>
              <ArrowUpRight size={15} />
            </a>
            {standalone && (
              <Link
                className="text-link workspace-header-link"
                href="/connections"
                aria-label={t('Connections')}
              >
                <span>{t('Connections')}</span>
                <Plug size={16} className="workspace-connections-icon" aria-hidden="true" />
              </Link>
            )}
            <a href={signOut} target="_top" className="user-chip" title={t('Sign out')}>
              {profile.name.charAt(0).toUpperCase()}
            </a>
          </div>
        </div>
      </header>
      <ContentClipboardDialog workspace={activeWorkspace} clipboard={clipboard} />
      <div className="workspace-grid">
        <aside className="sidebar">
          <div className="sidebar-label">{t('YOUR CONTROL ROOM')}</div>
          <nav>
            {(
              [
                { key: 'links', label: 'Your links', icon: Link2 },
                { key: 'profile', label: 'Your profile', icon: UserRound },
                { key: 'domains', label: 'Custom domain', icon: Globe },
                { key: 'metrics', label: 'Analytics', icon: BarChart3 },
                { key: 'chatgpt', label: 'Use ChatGPT', icon: Sparkles },
                { key: 'history', label: 'Change history', icon: History },
              ] as const
            ).map((item) => (
              <a
                key={item.key}
                href={dashboardHref(item.key, profile.id)}
                aria-current={tab === item.key ? 'page' : undefined}
                aria-disabled={busy && !workspace.autosaving ? true : undefined}
                className={tab === item.key ? 'active' : ''}
              >
                <item.icon size={18} />
                {t(item.label)}
                {item.key === 'chatgpt' && <span className="new-tag">{t('NEW')}</span>}
              </a>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="little-spark">
              <BrandSpark />
            </span>
            <p>
              {t('One address.')}
              <br />
              {t('All of you.')}
            </p>
            <span>{spaceAddress(profile).replace('https://', '')}</span>
          </div>
        </aside>
        <main className="workspace-main">
          <div className="workspace-title">
            <div>
              <div className="eyebrow">
                {t('HEY,') + ' '}
                {profile.name.split(' ')[0].toUpperCase()}{' '}
                <span aria-hidden="true">
                  <BrandSpark />
                </span>
              </div>
              <h1>
                {t(
                  {
                    links: 'Everywhere you are.',
                    profile: 'Make it yours.',
                    domains: 'Your own address.',
                    chatgpt: 'Just say the word.',
                    history: 'Nothing lost.',
                    metrics: 'See what connects.',
                  }[tab],
                )}
              </h1>
              <p>
                {t(
                  {
                    links: 'Your world, one link at a time.',
                    profile: 'A familiar face. A few words. Your kind of color.',
                    domains: 'Connect your domain to this space.',
                    chatgpt: 'Your next update is a conversation away.',
                    history: 'Every change has a way back.',
                    metrics: 'A little insight into your corner of the internet.',
                  }[tab],
                )}
              </p>
            </div>
            {tab === 'links' && (
              <AddItemMenu
                onPaste={() => void clipboard.openPaste()}
                buttonRef={addLinkButton}
                busy={busy}
                contentDisabled={newProfileTab}
                sectionDisabled={
                  profileLayout.tabs.reduce((count, tab) => count + tab.sections.length, 0) >= 20
                }
                onAdd={(kind) => {
                  addLinkButton.current?.focus({ preventScroll: true });
                  edit(kind);
                }}
                onSection={() =>
                  changeLayout({
                    ...layout,
                    sections: [
                      ...layout.sections,
                      { id: crypto.randomUUID(), title: 'New section', slugs: [] },
                    ],
                  })
                }
              />
            )}
          </div>
          {alerts}
          {tab === 'metrics' && <MetricsPanel key={profile.id} spaceId={profile.id} />}
          {tab === 'links' && <WorkspaceLinks workspace={activeWorkspace} clipboard={clipboard} />}
          {tab === 'profile' && <ProfileSettings workspace={activeWorkspace} />}
          {tab === 'domains' && (
            <DomainSettings
              key={profile.id}
              profile={profile}
              onChanged={(publicDomain) =>
                workspace.setProfile((current) =>
                  current?.id === profile.id ? { ...current, publicDomain } : current,
                )
              }
            />
          )}
          {tab === 'chatgpt' && <ChatGPTPanel standalone={standalone} handle={profile.handle} />}
          {tab === 'history' && <HistoryPanel workspace={activeWorkspace} />}
          <CatalogCredit />
        </main>
        <aside className="preview-column">
          <div className="preview-heading">
            <span>{t('YOUR PAGE')}</span>
            <a
              href={profile.publicDomain ? spaceAddress(profile) : `/${profile.handle}`}
              target="_blank"
              rel="noreferrer"
              aria-label={t('Open your profile')}
            >
              <ArrowUpRight size={17} />
            </a>
          </div>
          {profile.pageStyle === 'desktop' ? (
            <DesktopProfile
              key={profile.id}
              profile={previewProfile!}
              preview
              selectedTab={activeProfileTab.id}
              onSelectTab={selectProfileTab}
            />
          ) : (
            <ProfileCard
              profile={previewProfile!}
              preview
              selectedTab={activeProfileTab.id}
              onSelectTab={selectProfileTab}
            />
          )}
          <div className="preview-caption">
            <span className="status-dot" />
            {layoutChanged ? t('Previewing unsaved layout') : t('Updates as you save')}
          </div>
        </aside>
      </div>
      <SiteFooter feedback />
    </div>
  );
}
