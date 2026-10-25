'use client';

import { useId, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { Popover } from 'radix-ui';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { normalizeBadgeEmbed, parseBadgeInput, type BadgeEmbed } from '@/lib/badge';
import { BadgeEmbedView } from '../badge-embed';
import { useTranslation } from '../language-provider';

export type BadgePickerAnchor = {
  getBoundingClientRect: () => DOMRect;
  contextElement?: Element;
};

/** Accept copied embed snippets as data, never as markup to render. */
function parseSource(value: string): BadgeEmbed | null {
  const parsed = parseBadgeInput(value);
  if (parsed || !value.trim().startsWith('<') || value.length > 32 * 1024) return parsed;
  // Template contents stay inert, including resource loads. Only validated image
  // and link attributes leave this detached fragment.
  const template = document.createElement('template');
  template.innerHTML = value;
  const images = template.content.querySelectorAll('img');
  if (images.length !== 1) return null;
  const image = images[0];
  return normalizeBadgeEmbed({
    src: image.getAttribute('src'),
    alt: image.getAttribute('alt') ?? '',
    href: image.closest('a')?.getAttribute('href') ?? undefined,
  });
}

export function BadgePicker({
  anchor,
  initial,
  onInsert,
  onClose,
}: {
  anchor: BadgePickerAnchor;
  initial?: BadgeEmbed;
  onInsert: (badge: BadgeEmbed) => void;
  onClose: (options?: { restoreFocus: boolean }) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(true);
  const [source, setSource] = useState(initial?.src ?? '');
  const [alt, setAlt] = useState(initial?.alt ?? '');
  const [href, setHref] = useState(initial?.href ?? '');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const parsed = parseSource(source);
  const badge = parsed
    ? normalizeBadgeEmbed({ ...parsed, alt: alt.trim(), href: href.trim() || undefined })
    : null;

  function changeSource(value: string) {
    setSource(value);
    setError('');
    const next = parseSource(value);
    if (next && value.trim() !== next.src) {
      setAlt(next.alt);
      setHref(next.href ?? '');
    }
  }

  async function pasteImage(event: ClipboardEvent<HTMLInputElement>) {
    const file = event.clipboardData.files[0];
    if (!file) return;
    event.preventDefault();
    if (!['image/png', 'image/gif'].includes(file.type) || file.size > 16 * 1024) {
      setError('Use a PNG or GIF badge up to 16 KB and 320 × 64 pixels.');
      return;
    }
    setReading(true);
    setError('');
    try {
      const value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      if (!normalizeBadgeEmbed({ src: value, alt: '' })) throw new Error('Invalid badge image');
      changeSource(value);
    } catch {
      setError('Use a PNG or GIF badge up to 16 KB and 320 × 64 pixels.');
    } finally {
      setReading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (reading) return;
    if (!parsed) {
      setError('Paste a badge image URL, image, or embed code.');
      input.current?.focus();
      return;
    }
    if (!badge) {
      setError('Use a valid website link and a description up to 200 characters.');
      return;
    }
    onInsert(badge);
  }

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
          className="badge-picker"
          aria-label={t(initial ? 'Edit badge' : 'Add badge')}
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
          <div className="badge-picker-header">
            <strong>{t(initial ? 'Edit badge' : 'Add badge')}</strong>
            <Popover.Close
              type="button"
              className="badge-picker-close"
              aria-label={t('Close')}
              onClick={() => {
                restoreFocus.current = true;
              }}
            >
              <XIcon size={18} aria-hidden="true" />
            </Popover.Close>
          </div>
          <form onSubmit={submit} className="badge-picker-form">
            <div className="badge-picker-body">
              <label className="badge-picker-field" htmlFor={`${id}-source`}>
                <span>{t('Image or embed code')}</span>
                <input
                  ref={input}
                  id={`${id}-source`}
                  value={source}
                  onChange={(event) => changeSource(event.target.value)}
                  onBlur={() => {
                    if (source.trim() && !parsed)
                      setError('Paste a badge image URL, image, or embed code.');
                  }}
                  onPaste={pasteImage}
                  placeholder={t('Paste a badge here…')}
                  type="text"
                  maxLength={32 * 1024}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={!!error && !parsed}
                  aria-describedby={error ? `${id}-error` : undefined}
                />
              </label>
              <div className="badge-picker-preview" aria-label={t('Badge preview')}>
                {parsed ? (
                  <BadgeEmbedView
                    badge={{ ...parsed, alt: alt || parsed.alt }}
                    interactive={false}
                  />
                ) : (
                  <span>{t('Your badge, at its original size.')}</span>
                )}
              </div>
              <details className="badge-picker-details">
                <summary>{t('Link and description')}</summary>
                <label className="badge-picker-field" htmlFor={`${id}-link`}>
                  <span>{t('Link (optional)')}</span>
                  <input
                    id={`${id}-link`}
                    value={href}
                    onChange={(event) => {
                      setHref(event.target.value);
                      setError('');
                    }}
                    onBlur={() => {
                      if (parsed && !badge)
                        setError(
                          'Use a valid website link and a description up to 200 characters.',
                        );
                    }}
                    type="url"
                    placeholder="https://"
                    maxLength={2048}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </label>
                <label className="badge-picker-field" htmlFor={`${id}-alt`}>
                  <span>{t('Description (optional)')}</span>
                  <input
                    id={`${id}-alt`}
                    value={alt}
                    onChange={(event) => {
                      setAlt(event.target.value);
                      setError('');
                    }}
                    maxLength={200}
                    placeholder={t('What does this badge say?')}
                  />
                </label>
              </details>
              {error && (
                <p className="badge-picker-error" id={`${id}-error`} role="alert">
                  {t(error)}
                </p>
              )}
            </div>
            <div className="badge-picker-footer">
              <div className="badge-picker-sources">
                <a href="https://web.badges.world/" target="_blank" rel="noopener noreferrer">
                  web.badges.world <ArrowUpRightIcon size={12} aria-hidden="true" />
                </a>
                <a href="https://shields.io/" target="_blank" rel="noopener noreferrer">
                  Shields.io <ArrowUpRightIcon size={12} aria-hidden="true" />
                </a>
              </div>
              <button type="submit" className="badge-picker-submit" disabled={!badge || reading}>
                {t(initial ? 'Apply' : 'Insert badge')}
              </button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
