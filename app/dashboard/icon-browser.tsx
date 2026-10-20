'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useState } from 'react';
import { Check, Search } from 'lucide-react';
import {
  findIcons,
  iconCatalog,
  iconCategories,
  iconLabels,
  linkPresets,
  type IconCategory,
  type LinkIconId,
  type Platform,
} from '@/lib/link-options';
import { LinkIcon } from '../components/link-icon';

const pageSize = 36;
export default function IconBrowser({
  value,
  platform,
  onChoose,
  defaultIcon = linkPresets[platform].icon,
  itemType = 'link',
}: {
  value: LinkIconId | '';
  platform: Platform;
  defaultIcon?: LinkIconId;
  itemType?: 'link' | 'project';
  onChoose: (value: LinkIconId | '') => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<IconCategory | 'All'>('All');
  const [limit, setLimit] = useState(pageSize);
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase();
  const translatedMatches = iconCatalog.filter(
    (icon) =>
      (category === 'All' || icon.category === category) &&
      normalize(t(icon.label)).includes(normalize(query.trim())),
  );
  const matches = [
    ...new Map(
      [...findIcons(query, category), ...translatedMatches].map((icon) => [icon.id, icon]),
    ).values(),
  ];
  const results = matches.slice(0, limit);
  const suggestions = [
    ...new Set<LinkIconId>([
      ...(value ? [value] : []),
      defaultIcon,
      'link',
      'star',
      'heart',
      'sparkles',
    ]),
  ];
  function choice(id: LinkIconId) {
    return (
      <button
        type="button"
        className={`icon-choice${value === id ? ' selected' : ''}`}
        key={id}
        aria-label={t(iconLabels[id])}
        aria-pressed={value === id}
        onClick={() => onChoose(id)}
      >
        <LinkIcon icon={id} size={24} />
        <span>{t(iconLabels[id])}</span>
        {value === id && <Check className="icon-selected-mark" size={13} />}
      </button>
    );
  }
  return (
    <>
      <label className="icon-search">
        <span>{t('Find an icon')}</span>
        <span className="icon-search-input">
          <Search size={18} />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(pageSize);
            }}
            placeholder={t('Try GitHub, podcast, donation…')}
          />
        </span>
      </label>
      <div className="icon-categories" role="group" aria-label={t('Icon categories')}>
        {(['All', ...iconCategories] as const).map((item) => (
          <button
            type="button"
            key={t(item)}
            aria-pressed={category === item}
            onClick={() => {
              setCategory(item);
              setLimit(pageSize);
            }}
          >
            {t(item)}
          </button>
        ))}
      </div>
      <div className="icon-browser-results" key={`${category}:${query}`}>
        {!query.trim() && category === 'All' && (
          <section className="icon-suggestions" aria-label={t('Quick picks')}>
            <h3>{t('Quick picks')}</h3>
            <div className="icon-grid">{suggestions.map(choice)}</div>
          </section>
        )}
        <div className="icon-results-heading">
          <h3>{category === 'All' ? t('All icons') : t(category)}</h3>
          <span role="status">
            {matches.length} {matches.length === 1 ? t('icon') : t('icons')}
          </span>
        </div>
        {!!results.length && (
          <div className="icon-grid">{results.map((icon) => choice(icon.id))}</div>
        )}
        {!matches.length && (
          <div className="icon-empty">
            <Search size={28} />
            <strong>{t('No icons found')}</strong>
            <p>{t('Try another word or browse all categories.')}</p>
            <button
              type="button"
              className="button button-small button-light"
              onClick={() => {
                setQuery('');
                setCategory('All');
                setLimit(pageSize);
              }}
            >
              {t('Reset search')}
            </button>
          </div>
        )}
        {matches.length > limit && (
          <button
            type="button"
            className="button button-small button-light icon-load-more"
            onClick={() => setLimit((current) => current + pageSize)}
          >
            {t('Show more (')}
            {matches.length - limit} {' ' + t('left)')}
          </button>
        )}
      </div>
      <div className="icon-dialog-footer">
        <button type="button" className="icon-preset-button" onClick={() => onChoose('')}>
          <LinkIcon icon={defaultIcon} />
          <span>
            <strong>{itemType === 'project' ? t('Use default icon') : t('Use preset icon')}</strong>
            <small>
              {itemType === 'project'
                ? t('Rocket icon for your project')
                : t('Matches your {name} link', { name: t(linkPresets[platform].label) })}
            </small>
          </span>
          {!value && <Check size={18} />}
        </button>
        <span className="icon-save-note">
          {t('Applied when you save the') + ' '}
          {t(itemType)}.
        </span>
      </div>
    </>
  );
}
