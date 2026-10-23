'use client';

import { CaretRightIcon } from '@phosphor-icons/react/dist/ssr/CaretRight';
import { TranslateIcon } from '@phosphor-icons/react/dist/ssr/Translate';
import { PaletteIcon } from '@phosphor-icons/react/dist/ssr/Palette';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowCounterClockwise';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { LanguageSwitcher } from '../language-switcher';
import { useTranslation } from '../language-provider';

export function DesktopSettings({
  apps,
  disabled,
  onOpen,
  onReset,
}: {
  apps: { id: string; title: string; Icon: PhosphorIcon; color: string }[];
  disabled: boolean;
  onOpen: (id: string) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="desktop-settings">
      <nav className="desktop-settings-pages" aria-label={t('Settings')}>
        <button type="button" onClick={() => onOpen('appearance')} disabled={disabled}>
          <span className="desktop-setting-icon desktop-color-peach">
            <PaletteIcon weight="regular" aria-hidden="true" size={22} />
          </span>
          <span>
            <strong>{t('Appearance')}</strong>
            <small>{t('Colors and typography.')}</small>
          </span>
          <CaretRightIcon weight="regular" aria-hidden="true" size={18} />
        </button>
        {apps.map(({ id, title, Icon, color }) => (
          <button key={id} type="button" onClick={() => onOpen(id)} disabled={disabled}>
            <span className={`desktop-setting-icon desktop-color-${color}`}>
              <Icon weight="regular" aria-hidden="true" size={22} />
            </span>
            <span>
              <strong>{title}</strong>
              <small>{t('Connect your own web address.')}</small>
            </span>
            <CaretRightIcon weight="regular" aria-hidden="true" size={18} />
          </button>
        ))}
      </nav>
      <section className="desktop-device-settings" aria-label={t('This device')}>
        <h3>{t('This device')}</h3>
        <div className="desktop-language-setting">
          <span>
            <TranslateIcon weight="regular" aria-hidden="true" size={20} />
            {t('Language')}
          </span>
          <LanguageSwitcher />
        </div>
        <button
          className="desktop-reset-setting"
          type="button"
          onClick={onReset}
          disabled={disabled}
        >
          <ArrowCounterClockwiseIcon weight="regular" aria-hidden="true" size={20} />
          <span>
            <strong>{t('Reset desktop')}</strong>
            <small>{t('Put windows back in their starting positions.')}</small>
          </span>
        </button>
      </section>
    </div>
  );
}
