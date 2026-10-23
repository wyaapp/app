'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useRef, useState, type FormEvent } from 'react';
import { useEntryAutosave, EntrySaveStatus } from './use-entry-autosave';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import type { LinkItem } from '@/lib/model';
import { interestDefinitions, suggestInterestSlug, type InterestType } from '@/lib/interests';
import { ItemButtonsEditor } from './item-buttons-editor';
import type { ItemButtonDraft } from '@/lib/item-buttons';
import { CatalogPicker } from './catalog-picker';
import { catalogUrl, type CatalogItem } from '@/lib/catalog-types';
import { ContentCover } from '../components/content-cover';
import { LinkIcon } from '../components/link-icon';

export function InterestEditor({
  item,
  type,
  existingSlugs,
  busy,
  onSave,
  onClose,
}: {
  item: LinkItem | 'new';
  type: InterestType;
  handle: string;
  existingSlugs: string[];
  busy: boolean;
  onSave: (data: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isNew = item === 'new',
    definition = interestDefinitions[type];
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [searching, setSearching] = useState(isNew);
  const [buttons, setButtons] = useState<ItemButtonDraft[]>(
    isNew
      ? []
      : (item.interest?.buttons ?? []).map((button) => ({
          label: button.label,
          destination: button.url,
        })),
  );
  const title = selected?.title ?? (isNew ? '' : item.label);
  const cover = selected ? selected.coverUrl : isNew ? undefined : item.interest?.coverUrl;
  function choose(result: CatalogItem) {
    setSelected(result);
    setSearching(false);
  }
  const formRef = useRef<HTMLFormElement>(null);
  const catalog = selected?.source ?? (isNew ? undefined : item.interest?.catalog);
  const fallback =
    selected || (!isNew && item.interest?.buttons?.length)
      ? catalog
        ? catalogUrl(catalog)
        : null
      : isNew
        ? null
        : item.url || null;
  const payload = {
    action: 'upsert_interest',
    interestType: type,
    createOnly: isNew,
    slug: isNew ? suggestInterestSlug(title, existingSlugs, type) : item.slug,
    ...(!isNew ? { originalSlug: item.slug } : {}),
    label: title,
    buttons,
    ...(selected ? { catalog: selected.source, coverUrl: selected.coverUrl ?? null } : {}),
    ...(!buttons.length ? { destination: fallback } : {}),
    ...(isNew ? { visible: true } : {}),
  };
  const autosave = useEntryAutosave({ enabled: !isNew, payload, busy, form: formRef, onSave });
  async function saveSelection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (isNew && !selected)) return;
    if (isNew) {
      if (await onSave(payload)) onClose();
    } else await autosave.flush();
  }
  return (
    <section className="editor-panel interest-selection-panel">
      <div className="panel-heading">
        <h2>
          {isNew
            ? t('Add {type}', { type: t(definition.label).toLowerCase() })
            : t('Edit {type}', { type: t(definition.label).toLowerCase() })}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Close interest editor')}
          onClick={onClose}
          disabled={busy}
        >
          <XIcon weight="regular" aria-hidden="true" size={18} />
        </button>
      </div>
      {searching ? (
        <CatalogPicker type={type} disabled={busy} onSelect={choose} />
      ) : (
        <>
          <div
            className="catalog-selection"
            aria-label={t('Selected {type}', { type: t(definition.label).toLowerCase() })}
          >
            <ContentCover
              url={cover}
              className="catalog-selection-cover"
              fallback={
                <span
                  className="catalog-selection-cover interest-cover-fallback"
                  aria-hidden="true"
                >
                  <LinkIcon platform="website" icon={definition.icon} />
                </span>
              }
            />
            <div>
              <strong>{title}</strong>
              {selected && (
                <small>{[selected.year, ...selected.platforms].filter(Boolean).join(' · ')}</small>
              )}
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => setSearching(true)}
              >
                {t('Choose another') + ' '}
                {t(definition.label).toLowerCase()}
              </button>
            </div>
          </div>
          <form ref={formRef} onSubmit={saveSelection} className="game-options-form">
            <ItemButtonsEditor
              label="Buttons (optional)"
              buttons={buttons}
              onChange={setButtons}
              busy={busy}
              hint="Add up to three links, such as Steam, Official site, or My review."
              newLabel=""
            />
            <div className="catalog-selection-actions">
              {isNew ? (
                <>
                  <button type="submit" className="button button-dark" disabled={busy || !selected}>
                    {busy
                      ? t('Saving…')
                      : t('Add {type}', { type: t(definition.label).toLowerCase() })}
                    <CheckIcon weight="regular" aria-hidden="true" size={16} />
                  </button>
                  <button type="button" className="text-link" disabled={busy} onClick={onClose}>
                    {t('Cancel')}
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
                  <button type="button" className="text-link" disabled={busy} onClick={onClose}>
                    {t('Done')}
                  </button>
                </>
              )}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
