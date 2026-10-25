'use client';

import { useState } from 'react';
import { imageDisplayMaxWidth, normalizeImageEmbed, type ImageEmbed } from '@/lib/image';
import { useTranslation } from './language-provider';
export { imageFromMarker, remarkImageEmbeds } from '@/lib/remark-images';

function ImageView({ image }: { image: ImageEmbed }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);

  return (
    <figure
      className="image-embed"
      style={{ maxWidth: imageDisplayMaxWidth(image) }}
      aria-busy={status === 'loading'}
    >
      <div className="image-embed-media" data-status={status}>
        {status !== 'failed' && (
          // The browser decodes the media directly; arbitrary URLs never reach a server fetch.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={attempt}
            src={image.src}
            alt={image.alt || ''}
            title={image.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            draggable={false}
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('failed')}
          />
        )}
        {status !== 'loaded' && (
          <div className="image-embed-status" role="status">
            <span>{t(status === 'failed' ? 'Image unavailable.' : 'Loading image…')}</span>
            {status === 'failed' && (
              <>
                <a href={image.src} target="_blank" rel="noopener noreferrer nofollow">
                  {t('Open original link')}
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setAttempt((value) => value + 1);
                    setStatus('loading');
                  }}
                >
                  {t('Try again')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}

/** Keep valid URLs in the document even when the remote image cannot be loaded. */
export function ImageEmbedView({ image }: { image: ImageEmbed }) {
  const validated = normalizeImageEmbed(image);
  return validated ? <ImageView key={validated.src} image={validated} /> : null;
}
