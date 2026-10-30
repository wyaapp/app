'use client';

import { useEffect, useMemo, type CSSProperties } from 'react';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import type { Profile } from '@/lib/profile-types';
import type { SpaceFile } from '@/lib/space-files';
import { getFileFormat } from '@/lib/file-formats';
import { parseFileDocument } from '@/lib/file-documents';
import { parseWidgetSource } from '@/lib/widget-files';
import { documentAppearanceStyle } from '@/lib/document-appearance';
import { fileForFragment, fileFragmentTarget } from '@/lib/page-fragments';
import { BioText } from '../bio-text';
import { ProfileAvatar } from '../profile-avatar';
import { FileCardProvider } from '../document-card-context';
import { PageDocument } from '../page-document';
import { useTranslation } from '../language-provider';
import { WidgetView } from '../widgets/widget-view';

/** Read-only published content. No window manager or editor is imported. */
export function ProfileColumn({
  profile,
  files,
  preview = false,
}: {
  profile: Profile;
  files: readonly SpaceFile[];
  preview?: boolean;
}) {
  const { t } = useTranslation();
  const Heading = preview ? 'h2' : 'h1';
  useEffect(() => {
    if (preview) return;
    function revealFragment() {
      let fragment: string;
      try {
        fragment = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (!fragment || document.getElementById(fragment)) return;
      const direct = document.getElementById(`mobile-${fragment}`);
      if (direct) {
        direct.scrollIntoView();
        return;
      }
      const file = fileForFragment({ ...profile, files: [...files] }, fragment);
      if (file)
        document
          .getElementById(`mobile-${fileFragmentTarget(file.id, fragment)}`)
          ?.scrollIntoView();
    }
    revealFragment();
    window.addEventListener('hashchange', revealFragment);
    return () => window.removeEventListener('hashchange', revealFragment);
  }, [profile, files, preview]);
  return (
    <div className="profile-column">
      <header className="profile-column-identity space-typography">
        <ProfileAvatar name={profile.name} url={profile.pictureUrl} />
        <div className="profile-column-name">
          <Heading>{profile.name}</Heading>
          <span className="profile-column-handle">@{profile.handle}</span>
        </div>
        <p className="profile-column-bio">
          <BioText text={profile.bio || t('A little corner of the internet.')} />
        </p>
      </header>
      {files.map((file) => (
        <MobileFileSection key={file.id} file={file} profile={profile} preview={preview} />
      ))}
    </div>
  );
}

function MobileFileSection({
  file,
  profile,
  preview,
}: {
  file: SpaceFile;
  profile: Profile;
  preview: boolean;
}) {
  const { t } = useTranslation();
  const format = getFileFormat(file.name);
  const parsed = useMemo(() => {
    try {
      if (format === 'widget') {
        const block = parseWidgetSource(file.content, { allowEmpty: false });
        return { block, links: block?.kind === 'discord' ? [block.item] : [], error: false };
      }
      return {
        block: null,
        links: format === 'markdown' ? parseFileDocument(file.content).data.links : [],
        error: false,
      };
    } catch {
      return { block: null, links: [], error: true };
    }
  }, [file.content, format]);
  const documentProfile = useMemo(
    () => ({ ...profile, links: parsed.links }),
    [profile, parsed.links],
  );
  const Icon = format === 'widget' ? SquaresFourIcon : FileTextIcon;
  const mediaRatio =
    parsed.block?.kind === 'gif' && parsed.block.gif.width && parsed.block.gif.height
      ? `${parsed.block.gif.width} / ${parsed.block.gif.height}`
      : '4 / 3';
  const style = {
    ...documentAppearanceStyle(file.appearance),
    '--mobile-media-ratio': mediaRatio,
  } as CSSProperties;
  return (
    <section
      id={`mobile-file-${file.id}`}
      data-mobile-file={file.id}
      data-file-format={format}
      data-document-theme={file.appearance?.theme ?? 'light'}
      className="profile-column-file document-appearance-surface"
      style={style}
      aria-labelledby={`mobile-file-title-${file.id}`}
    >
      <header className="profile-file-heading">
        <div className="mobile-file-heading">
          <span className="profile-file-icon" aria-hidden="true">
            <Icon weight="duotone" />
          </span>
          <h2 id={`mobile-file-title-${file.id}`}>{file.name}</h2>
        </div>
      </header>
      <FileCardProvider fileId={file.id} publishedLinks={profile.links} domIdPrefix="mobile-">
        <div
          className={`mobile-file-body document-appearance-content${format === 'widget' ? ' widget-content' : ''}`}
        >
          {parsed.error ? (
            <p className="mobile-file-error" role="status">
              {t('This document could not be displayed.')}
            </p>
          ) : format === 'text' ? (
            <pre className="mobile-file-text" tabIndex={0}>
              {file.content}
            </pre>
          ) : format === 'widget' && parsed.block ? (
            <WidgetView block={parsed.block} profile={documentProfile} preview={preview} />
          ) : (
            <PageDocument
              source={file.content}
              profile={documentProfile}
              appearance={file.appearance}
              preview={preview}
              preserveUnknown
            />
          )}
        </div>
      </FileCardProvider>
    </section>
  );
}
