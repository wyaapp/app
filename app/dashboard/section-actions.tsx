'use client';
import { useTranslation } from '@/app/components/language-provider';

import { CopyContentButton } from './copy-content-button';
import { useRef, useState } from 'react';
import { Popover } from 'radix-ui';
import { ClipboardPaste, ArrowDown, ArrowUp, MoreHorizontal, X } from 'lucide-react';

export function SectionActions({
  title,
  busy,
  canMoveUp,
  canMoveDown,
  onMove,
  tabs,
  activeTabId,
  onTabAssign,
  onRemove,
  onCopy,
  onPaste,
}: {
  onCopy?: () => Promise<boolean>;
  onPaste: () => void;
  title: string;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  tabs?: { id: string; title: string }[];
  activeTabId?: string;
  onTabAssign?: (id: string) => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pasting = useRef(false);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        pasting.current = false;
        setOpen(value);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Actions for section {name}', { name: title })}
          disabled={busy}
        >
          <MoreHorizontal size={20} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="item-actions"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label={t('Organize section {name}', { name: title })}
          onCloseAutoFocus={(event) => {
            if (pasting.current) event.preventDefault();
          }}
        >
          <div className="item-actions-heading">
            <strong>{t('Organize section')}</strong>
            <Popover.Close asChild>
              <button type="button" className="icon-button" aria-label={t('Close section actions')}>
                <X size={16} />
              </button>
            </Popover.Close>
          </div>
          <div className="item-actions-order">
            <button type="button" disabled={busy || !canMoveUp} onClick={() => onMove(-1)}>
              <ArrowUp size={16} />
              {t('Move up')}
            </button>
            <button type="button" disabled={busy || !canMoveDown} onClick={() => onMove(1)}>
              <ArrowDown size={16} />
              {t('Move down')}
            </button>
          </div>
          {tabs && tabs.length > 1 && onTabAssign && (
            <label>
              {t('Move to tab')}
              <select
                aria-label={t('Tab for section {name}', { name: title })}
                value={activeTabId}
                disabled={busy}
                onChange={(event) => {
                  setOpen(false);
                  onTabAssign(event.target.value);
                }}
              >
                {tabs.map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.title || 'Untitled'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="item-actions-hint">{t('Save layout to publish changes.')}</p>
          <div className="item-actions-secondary">
            {onCopy && <CopyContentButton label="Copy section" disabled={busy} onCopy={onCopy} />}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                pasting.current = true;
                setOpen(false);
                onPaste();
              }}
            >
              <ClipboardPaste size={16} />
              {t('Paste item here')}
            </button>
            {onRemove && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  onRemove();
                }}
              >
                <X size={16} />
                {t('Remove section, keep items')}
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
