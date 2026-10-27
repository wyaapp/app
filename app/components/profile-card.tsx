'use client';
import { useTranslation } from '@/app/components/language-provider';
import { useEffect, useState, type CSSProperties } from 'react';
import { profileThemeStyle } from '@/lib/profile-themes';
import { profileFontStyle } from '@/lib/profile-fonts';
import { BioText } from './bio-text';
import { BrandSpark } from './brand-spark';
import { ProfileAvatar } from './profile-avatar';
import type { Profile } from '@/lib/model';
import { spaceAddress } from '@/lib/public-address';
import { fileForFragment, fileFragmentTarget } from '@/lib/page-fragments';
import { PageDocument } from './page-document';
import { FileCardProvider } from './document-card-context';
import { parseFileDocument } from '@/lib/file-documents';
import { visibleProfile } from '@/lib/public-profile';
import { getFileFormat } from '@/lib/file-formats';
import { documentAppearanceStyle } from '@/lib/document-appearance';
export function ProfileCard({
  profile,
  preview = false,
  primary = false,
}: {
  profile: Profile;
  preview?: boolean;
  primary?: boolean;
}) {
  const { t } = useTranslation();
  const [openedFile, setOpenedFile] = useState<string>();
  const Heading = primary ? 'h1' : 'h2';
  const files = visibleProfile(profile).files ?? [];
  const selectedFile =
    files.find((file) => file.id === openedFile) ??
    files.find((file) => file.id === profile.defaultFileId) ??
    files[0];
  const pages = files.map((file) => ({
    id: file.id,
    title: getFileFormat(file.name) ? file.name.slice(0, file.name.lastIndexOf('.')) : file.name,
  }));
  const selectedId = selectedFile?.id;
  useEffect(() => {
    if (preview) return;
    let frame = 0;
    function readFragment() {
      let fragment = '';
      try {
        fragment = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      const file = fileForFragment(profile, fragment);
      if (!file) return;
      setOpenedFile(file.id);
      const target = fileFragmentTarget(file.id, fragment);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() =>
          document.getElementById(target)?.scrollIntoView({ block: 'nearest' }),
        );
      });
    }
    readFragment();
    window.addEventListener('popstate', readFragment);
    window.addEventListener('hashchange', readFragment);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', readFragment);
      window.removeEventListener('hashchange', readFragment);
    };
  }, [preview, profile]);
  return (
    <div
      className={`profile-card space-typography theme-${profile.theme}`}
      style={
        { ...profileThemeStyle(profile.theme), ...profileFontStyle(profile.font) } as CSSProperties
      }
    >
      <div className="profile-cover">
        <span>{spaceAddress(profile).replace('https://', '')}</span>
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
        {pages.length > 1 && (
          <nav className="profile-tabs" aria-label={t('Profile pages')}>
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                className={page.id === selectedId ? 'active' : ''}
                aria-pressed={page.id === selectedId}
                onClick={() => {
                  setOpenedFile(page.id);
                }}
              >
                {page.title}
              </button>
            ))}
          </nav>
        )}
        {selectedFile && getFileFormat(selectedFile.name) === 'text' ? (
          <div
            className="file-preview space-typography document-appearance-content"
            data-plain-text
            style={documentAppearanceStyle(selectedFile.appearance) as CSSProperties}
          >
            <pre>{selectedFile.content}</pre>
          </div>
        ) : selectedFile ? (
          <FileCardProvider fileId={selectedFile.id} publishedLinks={profile.links}>
            <PageDocument
              source={selectedFile.content}
              profile={{ ...profile, ...parseFileDocument(selectedFile.content).data }}
              appearance={selectedFile.appearance}
              preview={preview}
              preserveUnknown
            />
          </FileCardProvider>
        ) : null}
        <div className="profile-signature">
          {t('WHERE YOU AT?') + ' '}
          <strong>{t('RIGHT HERE ↗')}</strong>
        </div>
      </div>
    </div>
  );
}
