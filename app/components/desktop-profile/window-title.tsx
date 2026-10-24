'use client';

import { useRef, useState } from 'react';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { fileNameSchema } from '@/lib/space-files';
import { useTranslation } from '../language-provider';

/** The filename occupies the title bar, including while it is being renamed. */
export function WindowTitle({
  title,
  request,
  onRename,
}: {
  title: string;
  request: number;
  onRename: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [seenRequest, setSeenRequest] = useState(request);
  const [editing, setEditing] = useState(request > 0);
  const [name, setName] = useState(title);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (request !== seenRequest) {
    setSeenRequest(request);
    setEditing(true);
    setName(title);
    setError('');
  }
  function begin() {
    setName(title);
    setError('');
    setEditing(true);
  }
  function finish(restoreFocus: boolean) {
    setEditing(false);
    setError('');
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  }
  async function commit(restoreFocus: boolean) {
    if (inFlight.current) return;
    const parsed = fileNameSchema.safeParse(name);
    if (!parsed.success) {
      setError('Use a .md or .txt filename without folders.');
      return;
    }
    if (parsed.data === title) {
      finish(restoreFocus);
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      await onRename(parsed.data);
      finish(restoreFocus);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  if (!editing)
    return (
      <h2>
        <button
          ref={trigger}
          type="button"
          className="desktop-rename-title"
          aria-label={t('Rename {name}', { name: title })}
          title={t('Rename')}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={begin}
        >
          {title}
        </button>
      </h2>
    );
  return (
    <form
      className="desktop-title-form"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void commit(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) void commit(false);
      }}
    >
      <input
        aria-label={t('Filename')}
        aria-invalid={!!error}
        value={name}
        maxLength={100}
        disabled={saving}
        autoFocus
        onFocus={(event) => {
          const dot = event.currentTarget.value.lastIndexOf('.');
          event.currentTarget.setSelectionRange(0, dot > 0 ? dot : name.length);
        }}
        onChange={(event) => {
          setName(event.target.value);
          setError('');
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            finish(true);
          }
        }}
      />
      <button type="submit" disabled={saving} aria-label={t('Save name')} title={t('Save name')}>
        <CheckIcon size={17} aria-hidden="true" />
      </button>
      {error && (
        <span className="desktop-title-error" role="alert">
          {t(error)}
        </span>
      )}
    </form>
  );
}
