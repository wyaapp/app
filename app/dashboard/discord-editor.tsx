'use client';
import { EditorPanel, type EditorPresentation } from './editor-panel';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { QuestionIcon } from '@phosphor-icons/react/dist/ssr/Question';

import type { LinkItem } from '@/lib/profile-types';
import { parseDiscordSource, type DiscordWidgetData } from '@/lib/discord-widget-types';
import { suggestItemSlug } from '@/lib/item-slug';
import { useTranslation } from '../components/language-provider';
import { useFileCardId } from '../components/document-card-context';
import { DiscordWidget } from '../components/discord-widget';
import { DiscordSetupGuide } from './discord-setup-guide';
import { useEntryDraft, EntryManualActions } from './use-entry-draft';

export function DiscordEditor({
  item,
  handle,
  existingSlugs,
  busy,
  onSave,
  onClose,
  presentation,
  onOpenSetupGuide,
}: {
  item: LinkItem | 'new';
  handle: string;
  existingSlugs: string[];
  busy: boolean;
  onSave: (data: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
  presentation?: EditorPresentation;
  onOpenSetupGuide?: () => void;
}) {
  const { t } = useTranslation(),
    isNew = item === 'new';
  const fileId = useFileCardId();
  const sourceId = useId();
  const [source, setSource] = useState(isNew ? '' : item.discord!.guildId);
  const [selected, setSelected] = useState(
    isNew ? null : { guildId: item.discord!.guildId, label: item.label },
  );
  const [previewData, setPreviewData] = useState<DiscordWidgetData>();
  const [slug, setSlug] = useState(isNew ? '' : item.slug);
  const [visible, setVisible] = useState(isNew || item.visible);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [helpOpen, setHelpOpen] = useState(isNew);
  const sourceInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const payload = {
    action: 'upsert_discord',
    createOnly: isNew,
    ...(!isNew ? { originalSlug: item.slug } : {}),
    slug,
    guildId: selected?.guildId ?? '',
    label: selected?.label ?? '',
    visible,
  };
  useEntryDraft(payload);
  async function loadServer() {
    const guildId = parseDiscordSource(source);
    if (!guildId) {
      setError('Use a server ID or widget JSON URL, not an invite link or embed code.');
      if (!onOpenSetupGuide) setHelpOpen(true);
      return;
    }
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/discord-widget?guildId=${guildId}`, {
        signal: request.signal,
      });
      const data = (await response.json()) as DiscordWidgetData & { error?: string; code?: string };
      if (!response.ok) {
        if (data.code === 'disabled' && !onOpenSetupGuide) setHelpOpen(true);
        throw new Error(data.error || 'Could not load Discord right now. Try again shortly.');
      }
      if (request.signal.aborted) return;
      setSelected({ guildId, label: data.name.slice(0, 60) });
      setPreviewData(data);
      if (isNew && !slug) setSlug(suggestItemSlug(data.name, existingSlugs, 'discord'));
    } catch (cause) {
      if (!request.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not load Discord right now. Try again shortly.',
        );
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || loading) return;
    if (!selected || parseDiscordSource(source) !== selected.guildId) return loadServer();
    if (await onSave(payload)) onClose();
  }
  const previewItem: LinkItem | null = selected
    ? {
        kind: 'discord',
        discord: { guildId: selected.guildId },
        label: selected.label,
        platform: 'discord',
        url: '',
        slug,
        visible,
      }
    : null;
  return (
    <EditorPanel
      presentation={presentation}
      title={t(isNew ? 'Add a Discord server' : 'Edit Discord server')}
      closeLabel={t('Close Discord editor')}
      busy={busy}
      onClose={onClose}
      className="discord-editor"
    >
      <form ref={form} onSubmit={submit}>
        {onOpenSetupGuide ? (
          <div className="discord-setup-help">
            <button type="button" className="text-link" onClick={onOpenSetupGuide}>
              <QuestionIcon weight="regular" size={18} aria-hidden="true" />
              {t('Setup guide')}
            </button>
          </div>
        ) : (
          <DiscordSetupGuide
            open={helpOpen}
            onToggle={setHelpOpen}
            onContinue={() => {
              setHelpOpen(false);
              requestAnimationFrame(() => {
                sourceInput.current?.focus();
                sourceInput.current?.scrollIntoView({ block: 'center' });
              });
            }}
          />
        )}
        <div className="discord-source-label">
          <label htmlFor={sourceId}>{t('Server ID or widget URL')}</label>
          <span className="discord-source-input">
            <input
              id={sourceId}
              ref={sourceInput}
              value={source}
              maxLength={200}
              placeholder={t('Paste your server ID here')}
              aria-describedby={`${sourceId}-hint`}
              disabled={busy}
              onChange={(event) => {
                controller.current?.abort();
                setLoading(false);
                setError('');
                setSource(event.target.value);
              }}
            />
            <button
              className="button button-light"
              type="button"
              disabled={busy || loading || !source.trim()}
              onClick={() => void loadServer()}
            >
              {t(loading ? 'Loading…' : 'Load server')}
            </button>
          </span>
          <p className="field-description" id={`${sourceId}-hint`}>
            {t(
              'Use the long number from Discord, or your widget JSON URL. Invite links will not work here.',
            )}
          </p>
        </div>
        {error && (
          <p className="message error" role="alert">
            {t(error)}
          </p>
        )}
        {previewItem && (
          <>
            <div className="discord-editor-preview">
              <DiscordWidget item={previewItem} handle={handle} preview initialData={previewData} />
              {previewData && !previewData.inviteUrl && (
                <p className="field-description">
                  {t('Choose an Invite Channel in Discord to show a Join server button.')}
                </p>
              )}
            </div>
            {!fileId && (
              <label>
                {t('URL slug')}
                <input
                  value={slug}
                  required
                  maxLength={40}
                  pattern="[a-z0-9]([a-z0-9._-]{0,38}[a-z0-9])?"
                  disabled={busy}
                  onChange={(event) =>
                    setSlug(event.target.value.toLowerCase().replace(/\s+/g, '-'))
                  }
                />
              </label>
            )}
            <label className="discord-visibility">
              <input
                type="checkbox"
                checked={visible}
                disabled={busy}
                onChange={(event) => setVisible(event.target.checked)}
              />
              {t(fileId ? 'Visible in document' : 'Visible on profile')}
            </label>
          </>
        )}
        <div className="catalog-selection-actions">
          <EntryManualActions
            busy={busy}
            disabled={loading || !selected || parseDiscordSource(source) !== selected.guildId}
            onCancel={onClose}
          />
        </div>
      </form>
    </EditorPanel>
  );
}
