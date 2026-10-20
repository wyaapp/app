'use client';
import { useTranslation } from '@/app/components/language-provider';

import { lazy, Suspense, useState } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import {
  iconIds,
  iconLabels,
  linkPresets,
  type LinkIconId,
  type Platform,
} from '@/lib/link-options';
import { LinkIcon } from '../components/link-icon';

const IconBrowser = lazy(() => import('./icon-browser'));

export function IconPicker({
  value,
  platform,
  disabled,
  onChange,
  itemType = 'link',
}: {
  value: LinkIconId | '';
  platform: Platform;
  itemType?: 'link' | 'project';
  disabled: boolean;
  onChange: (value: LinkIconId | '') => void;
}) {
  const { t } = useTranslation();
  const defaultIcon = itemType === 'project' ? 'rocket' : linkPresets[platform].icon;
  const [open, setOpen] = useState(false);
  function choose(icon: LinkIconId | '') {
    onChange(icon);
    setOpen(false);
  }
  return (
    <fieldset className="icon-picker" disabled={disabled}>
      <legend>{itemType === 'project' ? t('Project icon') : t('Link icon')}</legend>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <div className="icon-picker-summary">
          <span className="link-icon">
            <LinkIcon platform={platform} icon={value || defaultIcon} />
          </span>
          <span className="icon-picker-current">
            <strong>{value ? t(iconLabels[value]) : t('Automatic')}</strong>
            <small>
              {value
                ? t('Picked by you.')
                : itemType === 'project'
                  ? t('Default rocket icon.')
                  : t('{name} preset icon.', { name: t(linkPresets[platform].label) })}
            </small>
          </span>
          <Dialog.Trigger asChild>
            <button type="button" className="button button-small button-light" disabled={disabled}>
              {t('Choose icon')}
            </button>
          </Dialog.Trigger>
        </div>
        <Dialog.Portal>
          <Dialog.Overlay className="icon-dialog-overlay" />
          <Dialog.Content className="icon-dialog">
            <div className="icon-dialog-heading">
              <div>
                <span className="eyebrow">{t('A little personality')}</span>
                <Dialog.Title>{t('Choose your icon')}</Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="icon-button" aria-label={t('Close icon picker')}>
                  <X size={22} />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="icon-dialog-description">
              {iconIds.length} {' ' + t('icons. Find the one that feels like you.')}
            </Dialog.Description>
            <Suspense
              fallback={
                <p className="icon-loading" role="status">
                  Loading icons…
                </p>
              }
            >
              <IconBrowser
                value={value}
                platform={platform}
                defaultIcon={defaultIcon}
                itemType={itemType}
                onChoose={choose}
              />
            </Suspense>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </fieldset>
  );
}
