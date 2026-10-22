'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useState } from 'react';
import type { LinkItem } from '@/lib/model';
import { ContentCover } from './content-cover';
import { LinkIcon } from './link-icon';
import { ItemButtons } from './item-buttons';
import { catalogUrl } from '@/lib/catalog-types';
import { useSpacePath } from './public-address-provider';

/** Shared collection surface; media-specific catalog/editing stays outside it. */
export function CollectionWidget({
  item,
  handle,
  preview = false,
}: {
  item: LinkItem;
  handle: string;
  preview?: boolean;
}) {
  const { t } = useTranslation();
  const path = useSpacePath(handle);
  const [expanded, setExpanded] = useState(false);
  const children = item.collection?.items.filter((child) => child.visible) ?? [];
  return (
    <section
      className="collection-section"
      id={`widget-${item.id ?? item.slug}`}
      aria-label={item.label || t('Game Collection')}
    >
      {item.label && <h3 className="public-section-title">{item.label}</h3>}
      <div className="collection-widget">
        <div
          className={`collection-grid ${expanded ? 'is-expanded' : ''}`}
          id={`games-${item.id ?? item.slug}`}
        >
          {children.map((game) => {
            const buttons = game.interest?.buttons ?? [];
            const defaultOnly =
              buttons.length === 1 &&
              buttons[0].label === 'Game page' &&
              game.interest?.catalog &&
              buttons[0].url === catalogUrl(game.interest.catalog);
            const cover = (
              <ContentCover
                url={game.interest?.coverUrl}
                className="collection-cover"
                fallback={
                  <span className="collection-cover collection-cover-fallback">
                    <LinkIcon icon="gamepad" />
                  </span>
                }
              />
            );
            return (
              <article
                data-analytics-item={preview ? undefined : (game.id ?? `legacy:${game.slug}`)}
                className="collection-game"
                aria-label={game.label}
                title={game.label}
                id={`interest-${game.id ?? game.slug}`}
                key={game.id ?? game.slug}
              >
                {game.url && !preview ? (
                  <a
                    href={path(game.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('Open {name}', { name: game.label })}
                  >
                    {cover}
                  </a>
                ) : (
                  cover
                )}
                {Boolean(buttons.length && !defaultOnly) && (
                  <details className="collection-game-links">
                    <summary>{t('Links')}</summary>
                    <ItemButtons
                      buttons={game.interest!.buttons!}
                      handle={handle}
                      slug={game.slug}
                      preview={preview}
                    />
                  </details>
                )}
              </article>
            );
          })}
        </div>
        {children.length > 4 && (
          <button
            type="button"
            className={`text-link collection-more ${children.length <= 8 ? 'collection-more-mobile' : ''}`}
            aria-expanded={expanded}
            aria-controls={`games-${item.id ?? item.slug}`}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? t('Show less') : t('Show all {count}', { count: children.length })}
          </button>
        )}
        {!children.length && <p className="field-description">{t('No games to show yet.')}</p>}
      </div>
    </section>
  );
}
