'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Popover } from 'radix-ui';
import { FetchError, type GiphyFetch } from '@giphy/js-fetch-api';
import { GifIcon } from '@phosphor-icons/react/dist/ssr/Gif';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/ssr/MagnifyingGlass';
import { normalizeGifEmbed, parseGifUrl, type GifEmbed } from '@/lib/gif';
import { getGiphyClient } from '@/lib/giphy-client';
import { GifEmbedView } from '../gif-embed';
import { useTranslation } from '../language-provider';

type GiphyResult = Awaited<ReturnType<GiphyFetch['search']>>['data'][number];
export type GifPickerAnchor = { getBoundingClientRect: () => DOMRect; contextElement?: Element };

function gifTitle(value: unknown) {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 300)
    : undefined;
}

function gifDimension(value: unknown) {
  const dimension = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isInteger(dimension) && dimension >= 1 && dimension <= 4096 ? dimension : undefined;
}

function resultEmbed(result: GiphyResult | null | undefined) {
  if (!result || typeof result !== 'object') return null;
  return normalizeGifEmbed({
    provider: 'giphy',
    id: result.id,
    title: gifTitle(result.title),
    width: gifDimension(result.images?.original?.width),
    height: gifDimension(result.images?.original?.height),
  });
}

function mediaUrl(result: GiphyResult | null | undefined) {
  const value = result?.images?.fixed_width_small?.url || result?.images?.fixed_width?.url;
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)giphy\.com$/.test(url.hostname) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Search media URLs live only in this picker. Published blocks store provider IDs. */
export function GifPicker({
  anchor,
  onInsert,
  onClose,
}: {
  anchor: GifPickerAnchor;
  onInsert: (gif: GifEmbed) => void;
  onClose: (options?: { restoreFocus: boolean }) => void;
}) {
  const { t, locale } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);
  const alive = useRef(true);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef(0);
  const [client, setClient] = useState<GiphyFetch | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<GiphyResult[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const term = query.trim();
  const link = parseGifUrl(query);
  const isUrl = /^(?:[a-z][a-z\d+.-]*:|www\.|(?:[a-z\d-]+\.)+[a-z]{2,}(?:[/#?]|$))/i.test(term);
  const tooLong = !isUrl && term.length > 50;

  useEffect(() => {
    let active = true;
    alive.current = true;
    getGiphyClient()
      .then((configured) => {
        if (active) setClient(configured);
      })
      .catch(() => {
        // Pasted provider links remain usable when search configuration is unavailable.
      })
      .finally(() => {
        if (active) setConfigLoading(false);
      });
    return () => {
      alive.current = false;
      active = false;
      request.current += 1;
      clearTimeout(debounce.current);
    };
  }, []);

  const search = useCallback(
    async (value: string, offset = 0) => {
      if (!client || !alive.current) return;
      const current = ++request.current;
      setLoading(true);
      setError('');
      if (offset === 0) {
        setResults([]);
        setNextOffset(null);
        setSearched(false);
        setSearchTerm(value);
        scroll.current?.scrollTo({ top: 0 });
      }
      try {
        const options = {
          limit: 12,
          offset,
          rating: 'pg' as const,
          lang: locale === 'pt-BR' ? 'pt' : 'en',
        };
        const response = value
          ? await client.search(value, options)
          : await client.trending(options);
        if (current !== request.current || !alive.current) return;
        if (!Array.isArray(response.data)) throw new Error('Unavailable');
        setResults((previous) => (offset ? [...previous, ...response.data] : response.data));
        const count = response.pagination?.count;
        const returnedOffset = response.pagination?.offset;
        const total = response.pagination?.total_count;
        const next = returnedOffset + count;
        setNextOffset(
          Number.isInteger(count) &&
            count > 0 &&
            Number.isInteger(returnedOffset) &&
            returnedOffset === offset &&
            Number.isInteger(total) &&
            next < total &&
            next <= (value ? 4999 : 499)
            ? next
            : null,
        );
        setSearched(true);
      } catch (failure) {
        if (current === request.current && alive.current)
          setError(
            failure instanceof FetchError && failure.status === 429
              ? 'Too many GIF searches. Try again shortly or paste a link.'
              : 'GIF search is unavailable. Try again or paste a link.',
          );
      } finally {
        if (current === request.current && alive.current) setLoading(false);
      }
    },
    [client, locale],
  );

  useEffect(() => {
    if (!client || isUrl || tooLong) return;
    const timer = setTimeout(() => void search(term), term ? 450 : 0);
    debounce.current = timer;
    return () => clearTimeout(timer);
  }, [client, isUrl, query, search, term, tooLong]);

  function changeQuery(value: string) {
    request.current += 1;
    clearTimeout(debounce.current);
    setQuery(value);
    setResults([]);
    setNextOffset(null);
    setSearched(false);
    setLoading(false);
    setError('');
  }

  function insert(gif: GifEmbed) {
    request.current += 1;
    clearTimeout(debounce.current);
    onInsert(gif);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    clearTimeout(debounce.current);
    if (link) insert(link);
    else if (!isUrl && !tooLong) void search(term);
  }

  const pending =
    configLoading || loading || (!!client && !searched && !error && !isUrl && !tooLong);
  const message = isUrl
    ? 'Paste a valid GIPHY or Tenor GIF link.'
    : tooLong
      ? 'Search with 50 characters or fewer.'
      : !configLoading && !client
        ? 'GIF search is unavailable. Paste a GIPHY or Tenor link.'
        : error;

  return (
    <Popover.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose({ restoreFocus: restoreFocus.current });
      }}
    >
      <Popover.Anchor virtualRef={{ current: anchor }} />
      <Popover.Portal>
        <Popover.Content
          className="gif-picker"
          aria-label={t('Choose a GIF')}
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={() => {
            restoreFocus.current = false;
          }}
          onEscapeKeyDown={() => {
            restoreFocus.current = true;
          }}
        >
          <form className="gif-picker-search-form" onSubmit={submit}>
            <MagnifyingGlassIcon size={18} aria-hidden="true" />
            <label className="sr-only" htmlFor={`${id}-search`}>
              {t('Search GIFs or paste a link…')}
            </label>
            <input
              ref={input}
              id={`${id}-search`}
              type="text"
              placeholder={t('Search GIFs or paste a link…')}
              value={query}
              maxLength={2048}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint={link ? 'done' : 'search'}
              aria-invalid={(isUrl && !link) || tooLong}
              onChange={(event) => changeQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  const first = scroll.current?.querySelector<HTMLButtonElement>(
                    '.gif-picker-grid button:not(:disabled)',
                  );
                  if (first) {
                    event.preventDefault();
                    first.focus();
                  }
                }
              }}
            />
            <Popover.Close
              type="button"
              className="gif-picker-close"
              aria-label={t('Close')}
              onClick={() => {
                restoreFocus.current = true;
              }}
            >
              <XIcon size={18} aria-hidden="true" />
            </Popover.Close>
          </form>
          <div className="gif-picker-results" ref={scroll} aria-busy={!link && pending}>
            {link ? (
              <div className="gif-picker-link-preview">
                <GifEmbedView gif={link} />
                <button type="button" className="gif-picker-insert" onClick={() => insert(link)}>
                  {t('Insert GIF')}
                </button>
              </div>
            ) : (
              <>
                {!isUrl && !tooLong && client && (
                  <div className="gif-picker-results-label">
                    <span>{t(searchTerm ? 'Search results' : 'Trending GIFs')}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="gif-picker-brand"
                      src="/giphy/powered-by-giphy.png"
                      alt="Powered by GIPHY"
                      width={100}
                      height={11}
                    />
                  </div>
                )}
                {results.length > 0 && (
                  <ul className="gif-picker-grid" aria-label={t('GIF results')}>
                    {results.map((gif, index) => {
                      const embed = resultEmbed(gif);
                      const media = mediaUrl(gif);
                      const creator = gifTitle(gif?.user?.display_name) || gifTitle(gif?.username);
                      return (
                        <li key={`${gif?.id}-${index}`}>
                          <button
                            type="button"
                            aria-label={gifTitle(gif?.title) || t('GIF')}
                            disabled={!embed || !media}
                            onClick={() => {
                              if (embed) insert(embed);
                            }}
                          >
                            {media ? (
                              // GIPHY media must load directly, with the original URL intact.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={media} alt="" loading="lazy" />
                            ) : (
                              <GifIcon size={24} aria-hidden="true" />
                            )}
                          </button>
                          {creator && (
                            <span className="gif-picker-creator" title={creator}>
                              {creator}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!message && pending && (
                  <p className="gif-picker-message" role="status">
                    {t('Loading GIFs…')}
                  </p>
                )}
                {!message && !pending && searched && !results.length && (
                  <p className="gif-picker-message" role="status">
                    {t('No GIFs found. Try another search.')}
                  </p>
                )}
                {message && (
                  <p className="gif-picker-message" role={error ? 'alert' : 'status'}>
                    {t(message)}
                  </p>
                )}
                {!loading && nextOffset !== null && (
                  <button
                    className="gif-picker-more"
                    type="button"
                    onClick={() => void search(searchTerm, nextOffset)}
                  >
                    {t('Load more')}
                  </button>
                )}
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
