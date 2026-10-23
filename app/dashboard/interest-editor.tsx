'use client';
import { EditorPanel, type EditorPresentation } from './editor-panel';
import { useTranslation } from '@/app/components/language-provider';

import { useRef, useState, type FormEvent } from 'react';
import { useEntryAutosave, EntrySaveStatus, EntryManualActions } from './use-entry-autosave';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';

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
  presentation,
}: {
  item: LinkItem | 'new';
  type: InterestType;
  handle: string;
  existingSlugs: string[];
  busy: boolean;
  onSave: (data: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
  presentation?: EditorPresentation;
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
    if (isNew || autosave.manual) {
      if (await onSave(payload)) onClose();
    } else await autosave.flush();
  }
  return (
    <EditorPanel
      presentation={presentation}
      title={
        isNew
          ? t('Add {type}', { type: t(definition.label).toLowerCase() })
          : t('Edit {type}', { type: t(definition.label).toLowerCase() })
      }
      closeLabel={t('Close interest editor')}
      busy={busy}
      onClose={onClose}
      className="interest-selection-panel"
    >
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
              {autosave.manual ? (
                <EntryManualActions busy={busy} disabled={isNew && !selected} onCancel={onClose} />
              ) : isNew ? (
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
    </EditorPanel>
  );
}
