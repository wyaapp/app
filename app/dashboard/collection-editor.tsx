'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useId, useRef, useState } from 'react';
import { useEntryAutosave, EntrySaveStatus } from './use-entry-autosave';
import { ArrowDown, ArrowUp, Check, Pencil, X } from 'lucide-react';
import { MAX_COLLECTION_ITEMS, type CollectionEntry } from '@/lib/collections';
import type { LinkItem } from '@/lib/model';
import { suggestInterestSlug } from '@/lib/interests';
import { type CatalogItem } from '@/lib/catalog-types';
import type { ItemButtonDraft } from '@/lib/item-buttons';
import { CatalogPicker } from './catalog-picker';
import { ItemButtonsEditor } from './item-buttons-editor';
import { ContentCover } from '../components/content-cover';
import { LinkIcon } from '../components/link-icon';

type Draft = {
  key: string;
  entry: CollectionEntry;
  title: string;
  coverUrl?: string;
  catalogId?: number;
  buttons: ItemButtonDraft[];
  visible: boolean;
};
export function CollectionEditor({
  item,
  handle,
  existingSlugs,
  busy,
  onSave,
  onClose,
}: {
  item: LinkItem | 'new';
  handle: string;
  existingSlugs: string[];
  busy: boolean;
  onSave: (data: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isNew = item === 'new';
  const formId = useId();
  const invalidFocus = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState(isNew ? '' : item.label);
  const [customSlug, setCustomSlug] = useState<string | null>(isNew ? null : item.slug);
  const slug =
    customSlug ?? suggestInterestSlug(title.trim() || 'game-collection', existingSlugs, 'game');
  const [visible, setVisible] = useState(isNew ? true : item.visible);
  const [draft, setDraft] = useState<Draft[]>(
    isNew
      ? []
      : (item.collection?.items ?? []).map((game) => ({
          key: game.id!,
          entry: { id: game.id! },
          title: game.label,
          coverUrl: game.interest?.coverUrl,
          catalogId: game.interest?.catalog?.id,
          buttons: (game.interest?.buttons ?? []).map((button) => ({
            label: button.label,
            destination: button.url,
          })),
          visible: game.visible,
        })),
  );
  const [editing, setEditing] = useState<string | null>(null),
    [announcement, setAnnouncement] = useState('');
  function add(game: CatalogItem) {
    if (
      draft.length >= MAX_COLLECTION_ITEMS ||
      draft.some((item) => item.catalogId === game.source.id)
    )
      return;
    const key = crypto.randomUUID();
    setDraft([
      ...draft,
      {
        key,
        title: game.title,
        coverUrl: game.coverUrl,
        catalogId: game.source.id,
        entry: {
          game: {
            title: game.title,
            source: game.source,
            ...(game.coverUrl ? { coverUrl: game.coverUrl } : {}),
          },
        },
        buttons: [],
        visible: true,
      },
    ]);
    setAnnouncement(`${game.title} added.`);
  }
  function move(index: number, offset: number) {
    const next = [...draft];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setDraft(next);
    setAnnouncement(`${draft[index].title} moved to position ${index + offset + 1}.`);
  }
  const formRef = useRef<HTMLFormElement>(null);
  const payload = {
    action: 'upsert_collection',
    slug,
    ...(!isNew ? { originalSlug: item.slug } : {}),
    label: title,
    createOnly: isNew,
    visible,
    entries: draft.map((game) => {
      const saved =
        !isNew && 'game' in game.entry
          ? item.collection?.items.find((child) => child.interest?.catalog?.id === game.catalogId)
          : undefined;
      const entry = saved ? { id: saved.id! } : game.entry;
      return {
        ...entry,
        ...(game.entry.buttons !== undefined || ('game' in game.entry && game.buttons.length > 0)
          ? { buttons: game.buttons }
          : {}),
      };
    }),
  };
  const autosave = useEntryAutosave({
    enabled: !isNew,
    payload,
    busy,
    form: formRef,
    onSave,
    valid: draft.length > 0,
  });
  return (
    <section
      className="editor-panel collection-editor"
      onInvalidCapture={(event) => {
        const input = event.target as HTMLInputElement;
        if (invalidFocus.current) {
          event.preventDefault();
          return;
        }
        const child = input.closest<HTMLElement>('[data-game-options]');
        if (child?.hidden) {
          event.preventDefault();
          invalidFocus.current = input;
          setEditing(child.dataset.gameOptions!);
          requestAnimationFrame(() => {
            invalidFocus.current = null;
            input.focus();
            input.reportValidity();
          });
        }
      }}
    >
      <div className="panel-heading">
        <h2>{isNew ? t('Add a Game Collection') : t('Edit Game Collection')}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Close widget editor')}
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <form
        ref={formRef}
        id={formId}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !draft.length) return;
          if (isNew) {
            if (await onSave(payload)) onClose();
          } else await autosave.flush();
        }}
      >
        <label>
          {t('Title (optional)')}
          <input
            value={title}
            placeholder={t('e.g. Games I like')}
            maxLength={60}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          {t('URL slug')}
          <input
            value={slug}
            onChange={(event) => setCustomSlug(event.target.value.replace(/\s+/g, '-'))}
            required
            maxLength={40}
            pattern="[A-Za-z0-9](?:[A-Za-z0-9._\-]{0,38}[A-Za-z0-9])?"
            disabled={busy}
          />
          <span className="field-description">
            wya.im/{handle}/{slug.trim().toLowerCase()}{' '}
            {' ' + t('opens this collection. Individual game URLs stay the same.')}
          </span>
        </label>
        {!isNew && (
          <p className="link-field-help">
            {t('Changing this slug retires the previous collection URL.')}
          </p>
        )}
      </form>
      <CatalogPicker
        type="game"
        disabled={busy || draft.length >= MAX_COLLECTION_ITEMS}
        selectedIds={draft.flatMap((game) =>
          game.catalogId === undefined ? [] : [game.catalogId],
        )}
        multiple
        onSelect={add}
      />
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {draft.length > 0 && (
        <div className="collection-editor-heading">
          <span>{t('Selected games')}</span>
          <span>
            {draft.length} / {MAX_COLLECTION_ITEMS}
          </span>
        </div>
      )}
      <ol className="collection-draft-list">
        {draft.map((game, index) => (
          <li key={game.key}>
            <div className="collection-draft-row">
              <ContentCover
                url={game.coverUrl}
                className="catalog-result-cover"
                fallback={
                  <span className="catalog-result-cover interest-cover-fallback">
                    <LinkIcon icon="gamepad" />
                  </span>
                }
              />
              <span className="collection-draft-title">
                {game.title}
                {!game.visible && <small>{t('Hidden (kept from original entry)')}</small>}
              </span>
              <div className="collection-draft-controls">
                <button
                  className="icon-button"
                  type="button"
                  disabled={busy || index === 0}
                  aria-label={t('Move {name} up', { name: game.title })}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  disabled={busy || index === draft.length - 1}
                  aria-label={t('Move {name} down', { name: game.title })}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  disabled={busy}
                  aria-label={t('Edit links for {name}', { name: game.title })}
                  aria-expanded={editing === game.key}
                  onClick={() => setEditing(editing === game.key ? null : game.key)}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  disabled={busy || (!isNew && draft.length === 1)}
                  title={
                    !isNew && draft.length === 1
                      ? t('Keep one game, or delete the collection from its menu.')
                      : undefined
                  }
                  aria-label={t('Remove {name}', { name: game.title })}
                  onClick={() => {
                    setDraft(draft.filter((item) => item.key !== game.key));
                    if (editing === game.key) setEditing(null);
                    setAnnouncement(`${game.title} removed.`);
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div
              className="collection-child-options"
              data-game-options={game.key}
              hidden={editing !== game.key}
            >
              <ItemButtonsEditor
                buttons={game.buttons}
                busy={busy}
                formId={formId}
                hint="Optional links for this game."
                newLabel=""
                onChange={(buttons) =>
                  setDraft(
                    draft.map((item) =>
                      item.key === game.key
                        ? { ...item, buttons, entry: { ...item.entry, buttons } }
                        : item,
                    ),
                  )
                }
              />
              {'id' in game.entry && (
                <label className="collection-visibility">
                  <input
                    type="checkbox"
                    checked={game.visible}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft(
                        draft.map((child) =>
                          child.key === game.key && 'id' in child.entry
                            ? {
                                ...child,
                                visible: event.target.checked,
                                entry: { ...child.entry, visible: event.target.checked },
                              }
                            : child,
                        ),
                      )
                    }
                  />
                  {t('Show this game')}
                </label>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="collection-editor-footer">
        <label className="collection-visibility">
          <input
            type="checkbox"
            checked={visible}
            disabled={busy}
            onChange={(event) => setVisible(event.target.checked)}
          />
          {t('Visible on profile')}
        </label>
        <div className="catalog-selection-actions">
          {isNew ? (
            <>
              <button className="text-link" type="button" disabled={busy} onClick={onClose}>
                {t('Cancel')}
              </button>
              <button
                type="submit"
                form={formId}
                className="button button-dark"
                disabled={busy || !draft.length}
              >
                {busy ? t('Saving…') : t('Add collection')}
                <Check size={16} />
              </button>
            </>
          ) : (
            <>
              <EntrySaveStatus
                status={autosave.status}
                onRetry={() => void autosave.flush()}
                onDiscard={() => {
                  if (autosave.discard()) onClose();
                }}
              />
              <button className="text-link" type="button" disabled={busy} onClick={onClose}>
                {t('Done')}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
