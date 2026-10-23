'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useEffect, useRef, useState, useId, type FormEvent } from 'react';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/ssr/MagnifyingGlass';
import type { InterestType } from '@/lib/interests';
import { interestDefinitions } from '@/lib/interests';
import type { CatalogItem } from '@/lib/catalog-types';
import { ContentCover } from '../components/content-cover';
import { LinkIcon } from '../components/link-icon';

export function CatalogPicker({
  type,
  disabled,
  onSelect,
  multiple = false,
  selectedIds = [],
}: {
  type: InterestType;
  disabled: boolean;
  multiple?: boolean;
  selectedIds?: number[];
  onSelect: (item: CatalogItem) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''),
    [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [searched, setSearched] = useState(false);
  const searchId = useId();
  const controller = useRef<AbortController | null>(null),
    definition = interestDefinitions[type];
  useEffect(() => () => controller.current?.abort(), []);
  async function search(event: FormEvent) {
    event.preventDefault();
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError('');
    setItems([]);
    setSearched(false);
    try {
      const response = await fetch(
        `/api/catalog?${new URLSearchParams({ type, query: query.trim() })}`,
        { signal: request.signal },
      );
      const data = (await response.json()) as { items: CatalogItem[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not search the catalog.');
      if (!request.signal.aborted) {
        setItems(data.items);
        setSearched(true);
      }
    } catch (error) {
      if (!request.signal.aborted)
        setError(error instanceof Error ? error.message : 'Could not search the catalog.');
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }
  return (
    <div className="catalog-picker">
      <form onSubmit={search} className="catalog-search-form">
        <label htmlFor={searchId}>
          {t('Search') + ' '}
          {t(definition.plural).toLowerCase()}
        </label>
        <div className="catalog-search-input">
          <input
            id={searchId}
            value={query}
            required
            minLength={2}
            maxLength={80}
            placeholder={t('Try Hollow Knight or Stardew Valley')}
            disabled={disabled}
            onChange={(event) => {
              controller.current?.abort();
              setLoading(false);
              setItems([]);
              setSearched(false);
              setError('');
              setQuery(event.target.value);
            }}
          />
          <button
            className="button button-light"
            type="submit"
            disabled={disabled || loading || query.trim().length < 2}
          >
            <MagnifyingGlassIcon weight="regular" aria-hidden="true" size={17} />
            {loading ? t('Searching…') : t('Search')}
          </button>
        </div>
      </form>
      <div aria-live="polite">
        {error && (
          <p className="message error" role="alert">
            {t(error)}
          </p>
        )}
        {searched && !items.length && (
          <p className="field-description">{t('No matches. Try another title.')}</p>
        )}
        {searched && items.length > 0 && (
          <p className="field-description">
            {multiple ? t('Choose games to add to your widget.') : t('Choose a game.')}
          </p>
        )}
      </div>
      {items.length > 0 && (
        <ul className="catalog-results" aria-label={t('Game search results')}>
          {items.map((item) => (
            <li key={item.source.id}>
              <button
                type="button"
                disabled={disabled || selectedIds.includes(item.source.id)}
                onClick={() => {
                  if (!multiple) {
                    controller.current?.abort();
                    setItems([]);
                    setSearched(false);
                  }
                  onSelect(item);
                }}
              >
                <ContentCover
                  url={item.coverUrl}
                  className="catalog-result-cover"
                  fallback={
                    <span
                      className="catalog-result-cover interest-cover-fallback"
                      aria-hidden="true"
                    >
                      <LinkIcon platform="website" icon={definition.icon} />
                    </span>
                  }
                />
                <span>
                  <strong>
                    {item.title}
                    {selectedIds.includes(item.source.id) && (
                      <span className="catalog-added">
                        <CheckIcon weight="regular" aria-hidden="true" size={14} />
                        {t('Added')}
                      </span>
                    )}
                  </strong>
                  <small>
                    {[item.year, ...item.platforms].filter(Boolean).join(' · ') ||
                      'Release information unavailable'}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
