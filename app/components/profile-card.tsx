'use client';
import { useTranslation } from '@/app/components/language-provider';
import { ProfileSections } from './profile-sections';
import Link from 'next/link';
import { getProfileLayout } from '@/lib/profile-tabs';
import type { CSSProperties } from 'react';
import { profileThemeStyle } from '@/lib/profile-themes';
import { BioText } from './bio-text';
import { BrandSpark } from './brand-spark';
import { ProfileAvatar } from './profile-avatar';
import type { Profile } from '@/lib/model';
export function ProfileCard({
  profile,
  preview = false,
  primary = false,
  selectedTab,
  onSelectTab,
}: {
  profile: Profile;
  preview?: boolean;
  primary?: boolean;
  selectedTab?: string;
  onSelectTab?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const Heading = primary ? 'h1' : 'h2';
  const pageLayout = getProfileLayout(profile);
  const layout =
    pageLayout.tabs.find((tab) => (preview ? tab.id === selectedTab : tab.slug === selectedTab)) ??
    pageLayout.tabs.find((tab) => tab.id === pageLayout.defaultTabId)!;
  return (
    <div
      className={`profile-card theme-${profile.theme}`}
      style={profileThemeStyle(profile.theme) as CSSProperties}
    >
      <div className="profile-cover">
        <span>wya.im/{profile.handle}</span>
        <span aria-hidden="true">
          <BrandSpark />
        </span>
      </div>
      <div className="profile-identity">
        <ProfileAvatar name={profile.name} url={profile.pictureUrl} />
        <div className="profile-heading">
          <Heading>{profile.name}</Heading>
          <span className="handle">@{profile.handle}</span>
        </div>
        <p className="profile-bio">
          <BioText text={profile.bio || t('A little corner of the internet.')} />
        </p>
      </div>
      <div className="profile-content">
        {pageLayout.tabs.length > 1 && (
          <nav className="profile-tabs" aria-label={t('Profile pages')}>
            {pageLayout.tabs.map((tab) =>
              preview ? (
                <button
                  key={tab.id}
                  type="button"
                  className={tab.id === layout.id ? 'active' : ''}
                  aria-pressed={tab.id === layout.id}
                  onClick={() => onSelectTab?.(tab.id)}
                >
                  {tab.title}
                </button>
              ) : (
                <Link
                  key={tab.id}
                  href={`/${profile.handle}?tab=${encodeURIComponent(tab.slug)}`}
                  scroll={false}
                  className={tab.id === layout.id ? 'active' : ''}
                  aria-current={tab.id === layout.id ? 'page' : undefined}
                >
                  {tab.title}
                </Link>
              ),
            )}
          </nav>
        )}
        <ProfileSections profile={profile} tab={layout} preview={preview} />
        <div className="profile-signature">
          {t('WHERE YOU AT?') + ' '}
          <strong>{t('RIGHT HERE ↗')}</strong>
        </div>
      </div>
    </div>
  );
}
