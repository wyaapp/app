'use client';
import { useTranslation } from '@/app/components/language-provider';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { StarIcon } from '@phosphor-icons/react/dist/ssr/Star';
import type { LinkItem } from '@/lib/model';
import { interestDefinitions } from '@/lib/interests';
import { ItemButtons } from './item-buttons';
import { ProfileTileMedia } from './profile-tile-media';
import { LinkIcon } from './link-icon';
import { useDocumentCard } from './document-card-context';

export function InterestTile({
  item,
  handle,
  preview = false,
}: {
  item: LinkItem;
  handle: string;
  preview?: boolean;
}) {
  const { t } = useTranslation();
  const card = useDocumentCard(handle);
  if (!item.interest) return null;
  const content = item.interest,
    definition = interestDefinitions[content.type];
  return (
    <article
      data-analytics-item={card.analyticsId(item, preview)}
      className="profile-tile interest-tile"
      id={card.domId('interest', item)}
    >
      <ProfileTileMedia url={content.coverUrl} portrait>
        <LinkIcon icon={definition.icon} />
      </ProfileTileMedia>
      <div className="profile-tile-content interest-content">
        <h3 className="profile-tile-title">
          {item.url && !preview && !content.buttons?.length ? (
            <a href={card.href(item)} target="_blank" rel="noopener noreferrer">
              {item.label}
              <ArrowUpRightIcon weight="regular" aria-hidden="true" size={15} />
            </a>
          ) : (
            item.label
          )}
        </h3>
        <span className="interest-type">{t(definition.label)}</span>
        {(content.status || content.favorite) && (
          <div className="interest-badges">
            {content.status && <span>{t(definition.statuses[content.status])}</span>}
            {content.favorite && (
              <span className="interest-favorite">
                <StarIcon weight="regular" size={12} aria-hidden="true" />
                {t('Favorite')}
              </span>
            )}
          </div>
        )}
        {content.note && <p>{content.note}</p>}
        {Boolean(content.buttons?.length) && (
          <ItemButtons
            buttons={content.buttons!}
            handle={handle}
            slug={item.slug}
            preview={preview}
          />
        )}
      </div>
    </article>
  );
}
