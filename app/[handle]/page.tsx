import { getTranslator } from '@/lib/i18n/server';
import { notFound, redirect } from 'next/navigation';
import { getPublicProfile } from '@/lib/service';
import { LanguageSwitcher } from '../components/language-switcher';
import { Brand } from '../components/brand';
import { ProfileCard } from '../components/profile-card';
import { PublicAnalytics } from '../components/public-analytics';
import { chatGPTSignInPath } from '../chatgpt-auth';

export const dynamic = 'force-dynamic';

type PublicProfileProps = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

export default async function PublicProfile({ params, searchParams }: PublicProfileProps) {
  const t = await getTranslator();
  const { handle } = await params;
  const query = await searchParams;
  const selectedTab = typeof query.tab === 'string' ? query.tab : undefined;

  const profile = await getPublicProfile(handle);
  if (!profile) notFound();

  const profilePath = `/${profile.handle}`;

  // Old usernames and case variants point to the current address, keeping the tab.
  if (handle !== profile.handle) {
    const tabQuery = selectedTab ? `?tab=${encodeURIComponent(selectedTab)}` : '';
    redirect(`${profilePath}${tabQuery}`);
  }

  return (
    <main className={`public-page theme-${profile.theme}`}>
      <PublicAnalytics path={profilePath} profile={profile} />

      <div className="public-brand">
        <Brand />
      </div>

      <ProfileCard profile={profile} primary selectedTab={selectedTab} />

      <a className="public-cta" href={chatGPTSignInPath('/dashboard')} target="_top">
        {t('Your links deserve a home, too.') + ' '}
        <strong>{t('Get your wya ↗')}</strong>
      </a>
      <div className="public-language">
        <LanguageSwitcher />
      </div>
    </main>
  );
}
