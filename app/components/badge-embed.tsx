'use client';

import { useState } from 'react';
import { badgeIsPixelArt, normalizeBadgeEmbed, type BadgeEmbed } from '@/lib/badge';
import { useTranslation } from './language-provider';

function BadgeImage({ badge, interactive }: { badge: BadgeEmbed; interactive: boolean }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const image = failed ? (
    <span className="web-badge-fallback" title={t('Badge unavailable.')}>
      {badge.alt || t('Badge unavailable.')}
    </span>
  ) : (
    // Shields serves SVG images, and classic badges can be tiny PNG/GIF data URLs.
    // Both stay isolated in an image element; no remote HTML or SVG is evaluated.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={badgeIsPixelArt(badge.src) ? 'is-pixel-art' : undefined}
      src={badge.src}
      alt={badge.alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
  return interactive && badge.href ? (
    <a
      className="web-badge"
      href={badge.href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={badge.alt || t('Open badge link')}
    >
      {image}
    </a>
  ) : (
    <span className="web-badge">{image}</span>
  );
}

/** Small inline images keep their intrinsic size instead of inheriting image-block sizing. */
export function BadgeEmbedView({
  badge,
  interactive = true,
}: {
  badge: BadgeEmbed;
  interactive?: boolean;
}) {
  const validated = normalizeBadgeEmbed(badge);
  return validated ? (
    <BadgeImage key={validated.src} badge={validated} interactive={interactive} />
  ) : null;
}
