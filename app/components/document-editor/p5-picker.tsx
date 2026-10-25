'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Popover } from 'radix-ui';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import { importP5Sketch } from '@/lib/p5-import';
import type { P5Embed } from '@/lib/p5';
import { useTranslation } from '../language-provider';

type P5PickerAnchor = {
  getBoundingClientRect: () => DOMRect;
  contextElement?: Element;
};

export function P5Picker({
  anchor,
  initial,
  initialInput,
  onInsert,
  onClose,
}: {
  anchor: P5PickerAnchor;
  initial?: P5Embed;
  initialInput?: string;
  onInsert: (sketch: P5Embed) => void;
  onClose: (options?: { restoreFocus: boolean }) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const restoreFocus = useRef(true);
  const [source, setSource] = useState(initialInput ?? initial?.url ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => request.current?.abort(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!source.trim() || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const sketch = await importP5Sketch(source, controller.signal);
      if (!controller.signal.aborted) onInsert(sketch);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Couldn't import this sketch.");
        input.current?.focus();
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (request.current === controller) request.current = null;
    }
  }

  return (
    <Popover.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          request.current?.abort();
          onClose({ restoreFocus: restoreFocus.current });
        }
      }}
    >
      <Popover.Anchor virtualRef={{ current: anchor }} />
      <Popover.Portal>
        <Popover.Content
          className="p5-picker"
          aria-label={t('p5.js sketch')}
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
          <div className="p5-picker-header">
            <strong>{t('p5.js sketch')}</strong>
            <Popover.Close
              type="button"
              className="p5-picker-close"
              aria-label={t('Close')}
              onClick={() => {
                restoreFocus.current = true;
              }}
            >
              <XIcon size={18} aria-hidden="true" />
            </Popover.Close>
          </div>
          <form className="p5-picker-form" onSubmit={submit} aria-busy={loading}>
            <label className="p5-picker-field" htmlFor={`${id}-source`}>
              <span>{t('Sketch URL or embed code')}</span>
              <input
                ref={input}
                id={`${id}-source`}
                type="text"
                value={source}
                onChange={(event) => {
                  setSource(event.target.value);
                  setError('');
                }}
                readOnly={loading}
                maxLength={16 * 1024}
                placeholder="https://editor.p5js.org/…"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={!!error}
                aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
              />
            </label>
            <p className="p5-picker-hint" id={`${id}-hint`}>
              {t('Live from p5.js. Saved changes appear on reload.')}
            </p>
            {error && (
              <p className="p5-picker-error" id={`${id}-error`} role="alert">
                {t(error)}
              </p>
            )}
            <button type="submit" className="p5-picker-submit" disabled={loading || !source.trim()}>
              {t(loading ? 'Loading sketch…' : initial ? 'Update sketch' : 'Insert sketch')}
            </button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
