'use client';

import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { EyeSlashIcon } from '@phosphor-icons/react/dist/ssr/EyeSlash';
import type { LinkItem, Profile } from '@/lib/profile-types';
import type { ProfileTab } from '@/lib/profile-tabs';
import { getLayoutGroups } from '@/lib/link-layout';
import { ProfileItem } from './profile-item';
import { useTranslation } from './language-provider';

/** Keep ordering, item rendering, and analytics identical in both page styles. */
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
  const { t } = useTranslation();
  const groups = getLayoutGroups(tab)
    .map((group) => ({
      ...group,
      links: group.slugs.flatMap(
        (slug) =>
          profile.links.find((link) => link.slug === slug && (link.visible || !!onEdit)) ?? [],
      ),
    }))
    .filter((group) => group.links.length);

  return groups.length ? (
    <div className="profile-links">
      {groups.map((group) => (
        <section className="public-link-section" key={group.id}>
          {group.id && group.title && <h3 className="public-section-title">{group.title}</h3>}
          {group.links.map((item) => {
            const content = (
              <ProfileItem
                key={item.id ?? item.slug}
                item={item}
                handle={profile.handle}
                preview={preview}
              />
            );
            return onEdit ? (
              <div className="desktop-editable-item" key={item.id ?? item.slug}>
                <div className="desktop-item-actions">
                  {!item.visible && (
                    <span>
                      <EyeSlashIcon weight="regular" aria-hidden="true" size={13} />
                      {t('Hidden')}
                    </span>
                  )}
                  <button
                    type="button"
                    className="desktop-edit-button"
                    aria-label={t('Edit {name}', { name: item.label || item.slug })}
                    onClick={() => onEdit(item)}
                  >
                    <PencilSimpleIcon weight="regular" aria-hidden="true" size={14} />
                    {t('Edit')}
                  </button>
                </div>
                {content}
              </div>
            ) : (
              content
            );
          })}
        </section>
      ))}
    </div>
  ) : (
    <p className="empty-profile">{t('Good things are on their way. Check back soon.')}</p>
  );
}
