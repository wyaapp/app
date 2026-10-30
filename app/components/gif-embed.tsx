'use client';

import { useEffect, useState } from 'react';
import {
  gifDisplayMaxWidth,
  gifEmbedUrl,
  gifSourceUrl,
  normalizeGifEmbed,
  type GifEmbed,
} from '@/lib/gif';
import { getGiphyClient } from '@/lib/giphy-client';
import { giphyImageFromResult, type GiphyImage } from '@/lib/giphy-media';
import { useTranslation } from './language-provider';
export { gifFromMarker, remarkGifEmbeds } from '@/lib/remark-gif';

function GiphyImageView({
  gif,
  presentation,
}: {
  gif: GifEmbed;
  presentation: 'document' | 'standalone';
}) {
  const { t } = useTranslation();
  const [image, setImage] = useState<GiphyImage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const client = await getGiphyClient();
        if (!client || !active) {
          if (active) setFailed(true);
          return;
        }
        const response = await client.gif(gif.id);
        const media = giphyImageFromResult(response.data, gif.id);
        if (!media) throw new Error('GIF unavailable.');
        if (active) setImage(media);
      } catch {
        if (active) setFailed(true);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [gif.id, attempt]);

  const width = image?.width ?? gif.width;
  const height = image?.height ?? gif.height;
  const ratio = width && height ? `${width} / ${height}` : '4 / 3';

  return (
    <figure
      className="gif-embed"
      data-presentation={presentation}
      style={presentation === 'document' ? { maxWidth: gifDisplayMaxWidth(gif) } : undefined}
      aria-busy={!loaded && !failed}
    >
      <div
        className="gif-embed-media"
        style={presentation === 'document' ? { aspectRatio: ratio } : undefined}
      >
        {image && !failed && (
          // Load the API's unchanged media URL directly, without an image proxy or player.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.src}
            alt={gif.title || t('GIF from {provider}', { provider: 'GIPHY' })}
            width={image.width}
            height={image.height}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
        {(!loaded || failed) && (
          <div className="gif-embed-status" role="status">
            <span>{t(failed ? 'GIF unavailable.' : 'Loading GIF…')}</span>
            {failed && (
              <a href={gifSourceUrl(gif)} target="_blank" rel="noopener noreferrer nofollow">
                {t('Open original link')}
              </a>
            )}
            {failed && (
              <button
                type="button"
                onClick={() => {
                  setImage(null);
                  setFailed(false);
                  setLoaded(false);
                  setAttempt((value) => value + 1);
                }}
              >
                {t('Try again')}
              </button>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}

/** Saved IDs resolve to images for GIPHY; Tenor retains its supported embed. */
export function GifEmbedView({
  gif,
  presentation = 'document',
}: {
  gif: GifEmbed;
  presentation?: 'document' | 'standalone';
}) {
  const { t } = useTranslation();
  const validated = normalizeGifEmbed(gif);
  if (!validated) return null;
  if (validated.provider === 'giphy')
    return <GiphyImageView key={validated.id} gif={validated} presentation={presentation} />;
  const ratio =
    validated.width && validated.height ? `${validated.width} / ${validated.height}` : '4 / 3';

  return (
    <figure
      className="gif-embed"
      data-presentation={presentation}
      style={presentation === 'document' ? { maxWidth: gifDisplayMaxWidth(validated) } : undefined}
    >
      <div
        className="gif-embed-media"
        style={presentation === 'document' ? { aspectRatio: ratio } : undefined}
      >
        <iframe
          src={gifEmbedUrl(validated)}
          title={validated.title || t('GIF from {provider}', { provider: 'Tenor' })}
          loading="lazy"
          referrerPolicy="no-referrer"
          allow="fullscreen"
          allowFullScreen
        />
      </div>
    </figure>
  );
}
