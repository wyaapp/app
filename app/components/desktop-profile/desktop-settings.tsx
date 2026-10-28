'use client';

import { useId, useRef, useState } from 'react';
import { DeviceMobileIcon } from '@phosphor-icons/react/dist/ssr/DeviceMobile';
import { CaretRightIcon } from '@phosphor-icons/react/dist/ssr/CaretRight';
import { KeyboardIcon } from '@phosphor-icons/react/dist/ssr/Keyboard';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { TranslateIcon } from '@phosphor-icons/react/dist/ssr/Translate';
import { PaletteIcon } from '@phosphor-icons/react/dist/ssr/Palette';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowCounterClockwise';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { useDesktopPreferences } from '@/lib/desktop-preferences';
import { LanguageSwitcher } from '../language-switcher';
import { useTranslation } from '../language-provider';

export function DesktopSettings({
  apps,
  disabled,
  onOpen,
  onReset,
  mainWindow,
}: {
  apps: { id: string; title: string; Icon: PhosphorIcon; color: string }[];
  disabled: boolean;
  onOpen: (id: string) => void;
  onReset: () => void;
  mainWindow?: MainWindowSettingProps;
}) {
  const { t } = useTranslation();
  const {
    renameShortcut,
    setRenameShortcut,
    iconMode,
    setIconMode,
    showFileExtensions,
    setShowFileExtensions,
  } = useDesktopPreferences();
  const renameId = useId();
  const iconModeId = useId();
  const extensionsId = useId();
  return (
    <div className="desktop-settings">
      <nav className="desktop-settings-pages" aria-label={t('Settings')}>
        <button type="button" onClick={() => onOpen('appearance')} disabled={disabled}>
          <span className="desktop-setting-icon desktop-color-peach">
            <PaletteIcon weight="duotone" aria-hidden="true" size={22} />
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
              <Icon weight="duotone" aria-hidden="true" size={22} />
            </span>
            <span>
              <strong>{title}</strong>
              <small>
                {t(
                  id === 'owner-billing'
                    ? 'View your plan and manage your subscription.'
                    : 'Connect your own web address.',
                )}
              </small>
            </span>
            <CaretRightIcon weight="regular" aria-hidden="true" size={18} />
          </button>
        ))}
      </nav>
      {mainWindow && <MainWindowSetting {...mainWindow} disabled={disabled} />}
      <section
        className="desktop-device-settings window-section-divider"
        aria-label={t('This device')}
      >
        <h3>{t('This device')}</h3>
        <div className="desktop-language-setting desktop-shortcut-setting">
          <TranslateIcon weight="regular" aria-hidden="true" size={20} />
          <strong>{t('Language')}</strong>
          <LanguageSwitcher />
        </div>
        <div className="desktop-shortcut-setting">
          <KeyboardIcon weight="regular" aria-hidden="true" size={20} />
          <div>
            <label htmlFor={renameId}>
              <strong>{t('Rename shortcut')}</strong>
            </label>
            <small id={`${renameId}-description`}>{t('For selected files and folders.')}</small>
          </div>
          <select
            id={renameId}
            value={renameShortcut}
            aria-describedby={`${renameId}-description`}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'Enter' || value === 'F2') setRenameShortcut(value);
            }}
          >
            <option value="Enter">Enter</option>
            <option value="F2">F2</option>
          </select>
        </div>
        <div className="desktop-shortcut-setting">
          <FileTextIcon weight="regular" aria-hidden="true" size={20} />
          <div>
            <label htmlFor={extensionsId}>
              <strong>{t('File extensions')}</strong>
            </label>
            <small id={`${extensionsId}-description`}>
              {t('Show or hide file extensions on Home icons.')}
            </small>
          </div>
          <select
            id={extensionsId}
            value={showFileExtensions ? 'show' : 'hide'}
            aria-describedby={`${extensionsId}-description`}
            onChange={(event) => setShowFileExtensions(event.target.value === 'show')}
          >
            <option value="show">{t('Show')}</option>
            <option value="hide">{t('Hide')}</option>
          </select>
        </div>
        <fieldset className="desktop-icon-layout-setting" aria-describedby={`${iconModeId}-hint`}>
          <legend>
            <SquaresFourIcon weight="regular" aria-hidden="true" size={20} />
            {t('Home icon layout')}
          </legend>
          <div className="desktop-icon-layout-options">
            {(
              [
                ['auto', 'Automatic', 'Drag to reorder. Icons fill the grid without gaps.'],
                ['free', 'Free positioning', 'Place icons anywhere, without snapping.'],
                ['grid', 'Snap to grid', 'Choose a grid slot and leave gaps wherever you like.'],
              ] as const
            ).map(([mode, label, description]) => (
              <label key={mode} className="desktop-icon-layout-option">
                <input
                  type="radio"
                  name={iconModeId}
                  value={mode}
                  checked={iconMode === mode}
                  onChange={() => setIconMode(mode)}
                  aria-labelledby={`${iconModeId}-${mode}-label`}
                  aria-describedby={`${iconModeId}-${mode}`}
                />
                <span>
                  <strong id={`${iconModeId}-${mode}-label`}>{t(label)}</strong>
                  <small id={`${iconModeId}-${mode}`}>{t(description)}</small>
                </span>
              </label>
            ))}
          </div>
          <small id={`${iconModeId}-hint`}>
            {t('For wide screens. Each mode keeps its own arrangement on this device.')}
          </small>
        </fieldset>
        <button
          className="desktop-reset-setting"
          type="button"
          onClick={onReset}
          disabled={disabled}
        >
          <ArrowCounterClockwiseIcon weight="regular" aria-hidden="true" size={20} />
          <span>
            <strong>{t('Reset Home')}</strong>
            <small>{t('Put windows and icons back in their starting positions.')}</small>
          </span>
        </button>
      </section>
    </div>
  );
}

type MainWindowSettingProps = {
  value: string;
  resolvedTitle: string;
  options: { id: string; title: string }[];
  onSave: (id: string | null) => Promise<boolean>;
};

function MainWindowSetting({
  value,
  resolvedTitle,
  options,
  onSave,
  disabled,
}: MainWindowSettingProps & { disabled: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const inFlight = useRef(false);
  const selected = draft ?? value;
  const validSelection = !selected || options.some((option) => option.id === selected);
  return (
    <section
      className="desktop-main-setting desktop-device-settings window-section-divider"
      aria-labelledby={id}
    >
      <div className="desktop-shortcut-setting">
        <DeviceMobileIcon weight="regular" aria-hidden="true" size={20} />
        <div>
          <label htmlFor={`${id}-select`} id={id}>
            <strong>{t('Main window')}</strong>
          </label>
          <small id={`${id}-description`}>
            {t('Opens first for visitors on mobile. Saved for this space.')}
          </small>
        </div>
        <select
          id={`${id}-select`}
          value={validSelection ? selected : ''}
          aria-describedby={`${id}-description ${id}-hint`}
          disabled={disabled || status === 'saving'}
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus('idle');
          }}
        >
          <option value="">{t('Automatic ({name})', { name: resolvedTitle })}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
      </div>
      <small id={`${id}-hint`}>
        {t('Only published files appear here. Desktop windows keep their saved arrangement.')}
      </small>
      <div className="desktop-main-setting-actions">
        <p role="status" className="desktop-color-status">
          {status === 'saving'
            ? t('Saving...')
            : status === 'saved'
              ? t('Main window saved.')
              : status === 'error'
                ? t('Could not save the Main window. Try again.')
                : ''}
        </p>
        <button
          type="button"
          className="button"
          disabled={disabled || status === 'saving' || selected === value || !validSelection}
          onClick={async () => {
            if (inFlight.current) return;
            inFlight.current = true;
            setStatus('saving');
            try {
              const saved = await onSave(selected || null);
              setStatus(saved ? 'saved' : 'error');
              if (saved) setDraft(null);
            } catch {
              setStatus('error');
            } finally {
              inFlight.current = false;
            }
          }}
        >
          {t('Save changes')}
        </button>
      </div>
    </section>
  );
}
