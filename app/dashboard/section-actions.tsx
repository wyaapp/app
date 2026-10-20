'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useState } from 'react';
import { Popover } from 'radix-ui';
import { ArrowDown, ArrowUp, MoreHorizontal, X } from 'lucide-react';

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
}: {
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
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
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
          {onRemove && (
            <div className="item-actions-secondary">
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
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
