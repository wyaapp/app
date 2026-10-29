'use client';

import { useMemo, type CSSProperties } from 'react';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import type { Profile } from '@/lib/profile-types';
import type { SpaceFile } from '@/lib/space-files';
import { getFileFormat } from '@/lib/file-formats';
import { parseFileDocument } from '@/lib/file-documents';
import { parseWidgetSource } from '@/lib/widget-files';
import { documentAppearanceStyle } from '@/lib/document-appearance';
import { BioText } from '../bio-text';
import { ProfileAvatar } from '../profile-avatar';
import { FileCardProvider } from '../document-card-context';
import { PageDocument } from '../page-document';
import { useTranslation } from '../language-provider';
import { WidgetView } from './widget-view';

/** Both this column and the desktop can exist during SSR, so DOM IDs have their own namespace. */
export function MobileProfileColumn({
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
  return (
    <div className="mobile-profile-column">
      <header className="mobile-profile-identity space-typography">
        <ProfileAvatar name={profile.name} url={profile.pictureUrl} />
        <div className="mobile-profile-name">
          <Heading>{profile.name}</Heading>
          <span className="mobile-profile-handle">@{profile.handle}</span>
        </div>
        <p className="mobile-profile-bio">
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
      className="mobile-profile-file document-appearance-surface"
      style={style}
      aria-labelledby={`mobile-file-title-${file.id}`}
    >
      <header className="desktop-window-bar">
        <div className="desktop-window-handle mobile-file-heading">
          <span className="desktop-window-icon" aria-hidden="true">
            <Icon weight="duotone" />
          </span>
          <h2 id={`mobile-file-title-${file.id}`}>{file.name}</h2>
        </div>
      </header>
      <FileCardProvider fileId={file.id} publishedLinks={profile.links} domIdPrefix="mobile-">
        <div
          className={`mobile-file-body document-appearance-content${format === 'widget' ? ' widget-window-content' : ''}`}
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
