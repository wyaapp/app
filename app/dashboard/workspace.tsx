'use client';
import Link from 'next/link';
import { OnboardingScreen } from './onboarding-screen';
import { SiteFooter } from '../components/site-footer';
import { BarChart3, ArrowUpRight, Check, Sparkles, History, Link2, UserRound } from 'lucide-react';
import { MAX_SPACES } from '@/lib/profile-types';
import { MetricsPanel } from './metrics-panel';
import { Brand } from '../components/brand';
import { BrandSpark } from '../components/brand-spark';
import { ProfileCard } from '../components/profile-card';
import { AddItemMenu } from './add-item-menu';
import { CatalogCredit } from '../components/catalog-credit';
import { CreateSpace } from './space-controls';
import { useWorkspace, type WorkspaceProps } from './use-workspace';
import { WorkspaceLinks } from './workspace-links';
import { ProfileSettings } from './profile-settings';
import { HistoryPanel } from './history-panel';
import { ChatGPTPanel } from './chatgpt-panel';

export default function Dashboard(props: WorkspaceProps) {
  const { displayName, signOut, standalone } = props;
  const workspace = useWorkspace(props);
  const {
    profile,
    spaces,
    creating,
    setCreating,
    tab,
    setTab,
    busy,
    error,
    setError,
    notice,
    setNotice,
    editing,
    setEditing,
    finishEntry,
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
    selectSpace,
  } = workspace;
  const alerts = (
    <div className="messages" aria-live="polite">
      {error && !(editing && typeof editing === 'object') && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="message success">
          <Check size={16} />
          {notice}
        </div>
      )}
    </div>
  );
  if (!profile || creating)
    return (
      <div className="site-shell page-with-footer">
        <header className="site-header">
          <Brand />
          <a className="text-link" href={signOut} target="_top">
            Sign out
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
        <SiteFooter />
      </div>
    );

  if (!workspace.onboarding) {
    return (
      <div className="onboarding-shell">
        <header className="site-header">
          <Brand />
          <a className="text-link" href={signOut} target="_top">
            Sign out
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
        <Brand />
        <div className="workspace-header-right">
          <a href={`/${profile.handle}`} target="_blank" rel="noreferrer" className="text-link">
            Visit your page <ArrowUpRight size={15} />
          </a>
          {standalone && (
            <Link className="text-link" href="/connections">
              Connections
            </Link>
          )}
          <a href={signOut} target="_top" className="user-chip" title="Sign out">
            {profile.name.charAt(0).toUpperCase()}
          </a>
        </div>
      </header>
      <div className="workspace-grid">
        <aside className="sidebar">
          <div className="sidebar-label">YOUR CONTROL ROOM</div>
          <nav>
            {(
              [
                { key: 'links', label: 'Your links', icon: Link2 },
                { key: 'profile', label: 'Your profile', icon: UserRound },
                { key: 'metrics', label: 'Analytics', icon: BarChart3 },
                { key: 'chatgpt', label: 'Use ChatGPT', icon: Sparkles },
                { key: 'history', label: 'Change history', icon: History },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                disabled={busy}
                className={tab === item.key ? 'active' : ''}
                onClick={async () => {
                  if (!(await finishEntry())) return;
                  setTab(item.key);
                  setEditing(null);
                  setError('');
                  setNotice('');
                }}
              >
                <item.icon size={18} />
                {item.label}
                {item.key === 'chatgpt' && <span className="new-tag">NEW</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="little-spark">
              <BrandSpark />
            </span>
            <p>
              One address.
              <br />
              All of you.
            </p>
            <span>wya.im/{profile.handle}</span>
          </div>
        </aside>
        <main className="workspace-main">
          <div className="space-switcher">
            <label>
              <span>Space</span>
              <select
                aria-label="Your spaces"
                value={profile.id}
                onChange={async (event) => {
                  const value = event.target.value;
                  if (value === '__new_space__') {
                    if (!(await finishEntry())) return;
                    setCreating(true);
                    setError('');
                    setNotice('');
                  } else void selectSpace(value);
                }}
                disabled={busy}
              >
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name} · @{space.handle}
                  </option>
                ))}
                <option value="__new_space__" disabled={spaces.length >= MAX_SPACES}>
                  ＋ Create a space{spaces.length >= MAX_SPACES ? ' (limit reached)' : ''}
                </option>
              </select>
            </label>
            <span className="space-count">
              {spaces.length} / {MAX_SPACES} spaces
            </span>
          </div>
          <div className="workspace-title">
            <div>
              <div className="eyebrow">
                HEY, {profile.name.split(' ')[0].toUpperCase()}{' '}
                <span aria-hidden="true">
                  <BrandSpark />
                </span>
              </div>
              <h1>
                {
                  {
                    links: 'Everywhere you are.',
                    profile: 'Make it yours.',
                    chatgpt: 'Just say the word.',
                    history: 'Nothing lost.',
                    metrics: 'See what connects.',
                  }[tab]
                }
              </h1>
              <p>
                {
                  {
                    links: 'Your world, one link at a time.',
                    profile: 'A familiar face. A few words. Your kind of color.',
                    chatgpt: 'Your next update is a conversation away.',
                    history: 'Every change has a way back.',
                    metrics: 'A little insight into your corner of the internet.',
                  }[tab]
                }
              </p>
            </div>
            {tab === 'links' && (
              <AddItemMenu
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
          {tab === 'links' && <WorkspaceLinks workspace={activeWorkspace} />}
          {tab === 'profile' && <ProfileSettings workspace={activeWorkspace} />}
          {tab === 'chatgpt' && <ChatGPTPanel standalone={standalone} handle={profile.handle} />}
          {tab === 'history' && <HistoryPanel workspace={activeWorkspace} />}
          <CatalogCredit />
        </main>
        <aside className="preview-column">
          <div className="preview-heading">
            <span>YOUR PAGE</span>
            <a
              href={`/${profile.handle}`}
              target="_blank"
              rel="noreferrer"
              aria-label="Open your profile"
            >
              <ArrowUpRight size={17} />
            </a>
          </div>
          <ProfileCard
            profile={previewProfile!}
            preview
            selectedTab={activeProfileTab.id}
            onSelectTab={selectProfileTab}
          />
          <div className="preview-caption">
            <span className="status-dot" />
            {layoutChanged ? 'Previewing unsaved layout' : 'Updates as you save'}
          </div>
        </aside>
      </div>
      <SiteFooter />
    </div>
  );
}
