'use client';

import type { LinkItem, Profile } from '@/lib/profile-types';
import type { ProfileTab } from '@/lib/profile-tabs';
import { getPageSource } from '@/lib/page-documents';
import { PageDocument } from './page-document';

/** Both profile styles and the editor render the same Markdown document and cards. */
export function ProfileSections({
  profile,
  tab,
  preview = false,
  onEdit,
}: {
  profile: Profile;
  tab: ProfileTab;
  preview?: boolean;
  onEdit?: (item: LinkItem) => void;
}) {
  return (
    <PageDocument
      source={getPageSource(profile, tab)}
      profile={profile}
      preview={preview}
      onEdit={onEdit}
    />
  );
}
