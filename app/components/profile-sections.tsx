'use client';

import type { Profile } from '@/lib/profile-types';
import type { ProfileTab } from '@/lib/profile-tabs';
import { getLayoutGroups } from '@/lib/link-layout';
import { ProfileItem } from './profile-item';
import { useTranslation } from './language-provider';

/** Keep ordering, item rendering, and analytics identical in both page styles. */
export function ProfileSections({
  profile,
  tab,
  preview = false,
}: {
  profile: Profile;
  tab: ProfileTab;
  preview?: boolean;
}) {
  const { t } = useTranslation();
  const groups = getLayoutGroups(tab)
    .map((group) => ({
      ...group,
      links: group.slugs.flatMap(
        (slug) => profile.links.find((link) => link.slug === slug && link.visible) ?? [],
      ),
    }))
    .filter((group) => group.links.length);

  return groups.length ? (
    <div className="profile-links">
      {groups.map((group) => (
        <section className="public-link-section" key={group.id}>
          {group.id && group.title && <h3 className="public-section-title">{group.title}</h3>}
          {group.links.map((item) => (
            <ProfileItem
              key={item.id ?? item.slug}
              item={item}
              handle={profile.handle}
              preview={preview}
            />
          ))}
        </section>
      ))}
    </div>
  ) : (
    <p className="empty-profile">{t('Good things are on their way. Check back soon.')}</p>
  );
}
