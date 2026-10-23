'use client';

import type { Icon } from '@phosphor-icons/react';
import { useTranslation } from '../language-provider';

export type ExplorerAppShortcut = { id: string; title: string; Icon: Icon; color: string };

/** Fixed applications are launchers, not user documents or movable folders. */
export function FileAppRow({
  app,
  selected,
  onSelect,
  onOpen,
}: {
  app: ExplorerAppShortcut;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const Icon = app.Icon;
  return (
    <li className="file-row" data-selected={selected || undefined} onFocus={onSelect}>
      <button
        className="file-open"
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        onDoubleClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            onOpen();
          }
        }}
      >
        <span className={`file-app-icon desktop-app-icon desktop-color-${app.color}`}>
          <Icon weight="regular" size={24} aria-hidden="true" />
        </span>
        <span className="file-list-name">
          <strong>{app.title}</strong>
          <small>{t('Application')}</small>
        </span>
      </button>
    </li>
  );
}
