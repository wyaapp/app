import { getTranslator } from '@/lib/i18n/server';
import { notFound, redirect } from 'next/navigation';
import { getPublicProfile } from '@/lib/service';
import { LanguageSwitcher } from '../components/language-switcher';
import { Brand } from '../components/brand';
import { ProfileColumn } from '../components/public-profile/profile-column';
import { orderColumnFiles } from '@/lib/mobile-layout';
import { profileThemeStyle } from '@/lib/profile-themes';
import { profileFontStyle } from '@/lib/profile-fonts';
import { cache, type CSSProperties } from 'react';
import { PublicAnalytics } from '../components/public-analytics';
import { appOrigin } from '@/lib/site-origin';
import { headers } from 'next/headers';
import { DOMAIN_HEADER } from '@/lib/custom-domains';
import { PublicAddressProvider } from '../components/public-address-provider';
import { spaceAddress } from '@/lib/public-address';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
const readProfile = cache(getPublicProfile);

type PublicProfileProps = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PublicProfileProps): Promise<Metadata> {
  const profile = await readProfile((await params).handle);
  return profile ? { title: profile.name, alternates: { canonical: spaceAddress(profile) } } : {};
}

export default async function PublicProfile({ params, searchParams }: PublicProfileProps) {
  const t = await getTranslator();
  const { handle } = await params;
  const query = await searchParams;

  const profile = await readProfile(handle);
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

  return (
    <PublicAddressProvider customDomain={customDomain}>
      <main
        className={`public-column-page theme-${profile.theme}`}
        style={
          {
            ...profileThemeStyle(profile.theme),
            ...profileFontStyle(profile.font),
          } as CSSProperties
        }
      >
        <PublicAnalytics
          path={profilePath}
          profile={profile}
          customHostname={customDomain ? profile.publicDomain?.hostname : undefined}
        />

        <div className="public-brand">
          <Brand href="https://wya.im" />
        </div>

        <ProfileColumn profile={profile} files={orderColumnFiles(profile, profile.files ?? [])} />

        <a className="public-cta" href={`${appOrigin()}/dashboard/files`} target="_top">
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
