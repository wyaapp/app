import { getTranslator } from '@/lib/i18n/server';
import { notFound, redirect } from 'next/navigation';
import { getPublicProfile } from '@/lib/service';
import { LanguageSwitcher } from '../components/language-switcher';
import { Brand } from '../components/brand';
import { ProfileCard } from '../components/profile-card';
import { DesktopProfile } from '../components/desktop-profile/desktop-profile';
import { PublicAnalytics } from '../components/public-analytics';
import { chatGPTSignInPath } from '../chatgpt-auth';
import { headers } from 'next/headers';
import { DOMAIN_HEADER } from '@/lib/custom-domains';
import { PublicAddressProvider } from '../components/public-address-provider';
import { spaceAddress } from '@/lib/public-address';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

type PublicProfileProps = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PublicProfileProps): Promise<Metadata> {
  const profile = await getPublicProfile((await params).handle);
  return profile ? { title: profile.name, alternates: { canonical: spaceAddress(profile) } } : {};
}

export default async function PublicProfile({ params, searchParams }: PublicProfileProps) {
  const t = await getTranslator();
  const { handle } = await params;
  const query = await searchParams;

  const profile = await getPublicProfile(handle);
  if (!profile) notFound();

  const profilePath = `/${profile.handle}`;
  const customDomain =
    (await headers()).get(DOMAIN_HEADER) === profile.publicDomain?.hostname &&
    Boolean(profile.publicDomain);
  if (!customDomain && profile.publicDomain?.redirect) {
    const target = new URL(`https://${profile.publicDomain.hostname}/`);
    for (const [key, value] of Object.entries(query).filter(([key]) => key !== 'tab'))
      for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value])
        target.searchParams.append(key, entry);
    redirect(target.href);
  }

  // Old usernames and case variants point to the current address.
  if (!customDomain && handle !== profile.handle) {
    const preserved = new URLSearchParams();
    for (const [key, value] of Object.entries(query).filter(([key]) => key !== 'tab'))
      for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value])
        preserved.append(key, entry);
    redirect(`${profilePath}${preserved.size ? `?${preserved}` : ''}`);
  }

  if (profile.pageStyle === 'desktop')
    return (
      <PublicAddressProvider customDomain={customDomain}>
        <main>
          <PublicAnalytics
            path={profilePath}
            profile={profile}
            customHostname={customDomain ? profile.publicDomain?.hostname : undefined}
          />
          <DesktopProfile
            key={profile.id}
            profile={profile}
            createHref={`https://wya.im${chatGPTSignInPath('/dashboard')}`}
          />
        </main>
      </PublicAddressProvider>
    );
  return (
    <PublicAddressProvider customDomain={customDomain}>
      <main className={`public-page theme-${profile.theme}`}>
        <PublicAnalytics
          path={profilePath}
          profile={profile}
          customHostname={customDomain ? profile.publicDomain?.hostname : undefined}
        />

        <div className="public-brand">
          <Brand href="https://wya.im" />
        </div>

        <ProfileCard profile={profile} primary />

        <a
          className="public-cta"
          href={`https://wya.im${chatGPTSignInPath('/dashboard')}`}
          target="_top"
        >
          {t('Your links deserve a home, too.') + ' '}
          <strong>{t('Get your wya ↗')}</strong>
        </a>
        <div className="public-language">
          <LanguageSwitcher />
        </div>
      </main>
    </PublicAddressProvider>
  );
}
