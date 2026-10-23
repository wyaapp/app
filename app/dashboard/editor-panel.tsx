'use client';

import type { ComponentPropsWithoutRef } from 'react';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';

export type EditorPresentation = 'panel' | 'window';

export function EditorPanel({
  presentation = 'panel',
  title,
  closeLabel,
  busy,
  onClose,
  className = '',
  children,
  ...props
}: ComponentPropsWithoutRef<'section'> & {
  presentation?: EditorPresentation;
  title: string;
  closeLabel: string;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <section
      {...props}
      className={`editor-panel${presentation === 'window' ? ' editor-panel-window' : ''}${className ? ` ${className}` : ''}`}
    >
      {presentation === 'panel' && (
        <div className="panel-heading">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={closeLabel}
            onClick={onClose}
            disabled={busy}
          >
            <XIcon weight="regular" aria-hidden="true" size={18} />
          </button>
        </div>
      )}
      {children}
    </section>
  );
}
