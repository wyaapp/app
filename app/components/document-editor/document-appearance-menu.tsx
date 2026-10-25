'use client';

import { useId, useRef, useState } from 'react';
import { Popover, RadioGroup } from 'radix-ui';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowCounterClockwise';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { PaletteIcon } from '@phosphor-icons/react/dist/ssr/Palette';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import {
  documentThemeIds,
  documentThemes,
  documentAppearanceStyle,
  normalizeDocumentColor,
  resolveDocumentAccent,
  type DocumentAppearance,
} from '@/lib/document-appearance';
import { fontIds, profileFonts, type ProfileFont } from '@/lib/profile-fonts';
import { profileThemes, themeIds } from '@/lib/profile-themes';
import { useTranslation } from '../language-provider';

export type DocumentAppearanceMenuProps = {
  value: DocumentAppearance;
  onChange: (value: DocumentAppearance) => void;
  disabled?: boolean;
};

export function DocumentAppearanceMenu({ value, onChange, disabled }: DocumentAppearanceMenuProps) {
  const { t } = useTranslation();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [spaceColor, setSpaceColor] = useState({ color: '#c3a6ff', text: '#1c1b1a' });
  const [accentReset, setAccentReset] = useState(0);
  const customized = Boolean(value.theme || value.accent || value.headingFont || value.bodyFont);

  function setAppearance<Key extends keyof DocumentAppearance>(
    key: Key,
    selection: DocumentAppearance[Key],
  ) {
    const next = { ...value };
    if (selection) next[key] = selection;
    else delete next[key];
    onChange(next);
  }

  function setAccent(selection: DocumentAppearance['accent']) {
    setAccentReset((previous) => previous + 1);
    setAppearance('accent', selection);
  }

  return (
    <Popover.Root
      onOpenChange={(open) => {
        // The popover lives in a portal, outside the space's CSS inheritance.
        if (open && trigger.current) {
          const style = getComputedStyle(trigger.current);
          setSpaceColor({
            color: style.getPropertyValue('--space-accent').trim() || '#c3a6ff',
            text: style.getPropertyValue('--space-accent-ink').trim() || '#1c1b1a',
          });
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          ref={trigger}
          className="document-appearance-trigger"
          aria-label={t('File appearance')}
          title={t('File appearance')}
          disabled={disabled}
          data-customized={customized || undefined}
        >
          <PaletteIcon weight="regular" aria-hidden="true" size={18} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="document-appearance-menu"
          style={{
            '--accent': spaceColor.color,
            '--profile-ink': spaceColor.text,
            ...documentAppearanceStyle(value),
          }}
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-labelledby={`${id}-title`}
          onEscapeKeyDown={(event) => {
            // Let an unfinished hex edit handle Escape before closing the popover.
            const target = event.target;
            if (
              target instanceof HTMLInputElement &&
              target.classList.contains('document-appearance-hex') &&
              target.value !== target.dataset.color
            )
              event.preventDefault();
          }}
        >
          <header className="document-appearance-heading">
            <strong id={`${id}-title`}>{t('File appearance')}</strong>
            <Popover.Close className="document-appearance-close" aria-label={t('Close')}>
              <XIcon weight="regular" size={18} aria-hidden="true" />
            </Popover.Close>
          </header>
          <div className="document-appearance-options">
            <div className="document-appearance-field">
              <span id={`${id}-theme`}>{t('Window theme')}</span>
              <RadioGroup.Root
                className="document-appearance-themes"
                aria-labelledby={`${id}-theme`}
                value={value.theme ?? 'light'}
                onValueChange={(selection) =>
                  setAppearance(
                    'theme',
                    selection === 'light' ? undefined : (selection as DocumentAppearance['theme']),
                  )
                }
                disabled={disabled}
              >
                {documentThemeIds.map((theme) => (
                  <RadioGroup.Item key={theme} value={theme} className="document-appearance-theme">
                    <span
                      className="document-appearance-theme-preview"
                      aria-hidden="true"
                      style={{
                        background: documentThemes[theme].background,
                        color: documentThemes[theme].text,
                      }}
                    >
                      <span className="document-appearance-theme-bar" />
                      <span className="document-appearance-theme-lines">
                        <span />
                        <span />
                      </span>
                      <RadioGroup.Indicator className="document-appearance-theme-check">
                        <CheckIcon size={14} />
                      </RadioGroup.Indicator>
                    </span>
                    <span>{t(documentThemes[theme].label)}</span>
                    {theme === 'light' && <small>{t('Default')}</small>}
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </div>
            <div className="document-appearance-field">
              <RadioGroup.Root
                aria-labelledby={`${id}-accent`}
                value={value.accent ?? 'inherit'}
                onValueChange={(selection) =>
                  setAccent(
                    selection === 'inherit'
                      ? undefined
                      : (selection as DocumentAppearance['accent']),
                  )
                }
                disabled={disabled}
              >
                <div className="document-appearance-field-heading">
                  <span id={`${id}-accent`}>{t('Main color')}</span>
                  <AppearanceDefault
                    label={t('Use space color')}
                    text={t('Use space color')}
                    onReset={() => setAccent(undefined)}
                  />
                </div>
                <div className="document-appearance-swatches document-appearance-accents">
                  {themeIds.map((accent) => (
                    <AppearanceSwatch
                      key={accent}
                      value={accent}
                      label={t(profileThemes[accent].label)}
                      color={profileThemes[accent].color}
                      ink={profileThemes[accent].text}
                      onSelect={() => setAccent(accent)}
                    />
                  ))}
                </div>
              </RadioGroup.Root>
              <AppearanceColorInput
                key={`accent-${accentReset}`}
                color={resolveDocumentAccent(value.accent)?.color ?? spaceColor.color}
                pickerLabel={t('Choose main color')}
                hexLabel={t('Main hex color')}
                onChange={(color) => setAppearance('accent', color)}
                disabled={disabled}
              />
            </div>
            <div className="document-appearance-fonts">
              {(['headingFont', 'bodyFont'] as const).map((field) => (
                <label key={field} className="document-appearance-font">
                  <span>{t(field === 'headingFont' ? 'Headings' : 'Body text')}</span>
                  <select
                    value={value[field] ?? 'inherit'}
                    disabled={disabled}
                    onChange={(event) =>
                      setAppearance(
                        field,
                        event.target.value === 'inherit'
                          ? undefined
                          : (event.target.value as ProfileFont),
                      )
                    }
                  >
                    <option value="inherit">{t('Use space font')}</option>
                    {fontIds.map((font) => (
                      <option key={font} value={font}>
                        {t(profileFonts[font].label)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
          <footer className="document-appearance-footer">
            <button
              type="button"
              className="document-appearance-reset"
              disabled={disabled || !customized}
              onClick={() => {
                setAccentReset((previous) => previous + 1);
                onChange({});
              }}
            >
              <ArrowCounterClockwiseIcon weight="regular" size={16} aria-hidden="true" />
              {t('Reset appearance')}
            </button>
          </footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AppearanceColorInput({
  color,
  pickerLabel,
  hexLabel,
  onChange,
  disabled,
}: {
  color: string;
  pickerLabel: string;
  hexLabel: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const errorId = useId();
  const [input, setInput] = useState({ color, draft: color, invalid: false });
  if (input.color !== color) setInput({ color, draft: color, invalid: false });

  function commit() {
    if (input.draft === color) return;
    const draft = input.draft.trim();
    const normalized = normalizeDocumentColor(draft.startsWith('#') ? draft : `#${draft}`);
    if (!normalized) {
      setInput({ ...input, invalid: true });
      return;
    }
    setInput({ color: normalized, draft: normalized, invalid: false });
    onChange(normalized);
  }

  return (
    <div className="document-appearance-custom-color">
      <div className="document-appearance-color-inputs">
        <input
          type="color"
          className="document-appearance-color-picker"
          value={color}
          aria-label={pickerLabel}
          title={pickerLabel}
          disabled={disabled}
          onInput={(event) => onChange(event.currentTarget.value)}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          type="text"
          className="document-appearance-hex"
          value={input.draft}
          data-color={color}
          aria-label={hexLabel}
          aria-invalid={input.invalid || undefined}
          aria-describedby={input.invalid ? errorId : undefined}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => setInput({ ...input, draft: event.target.value, invalid: false })}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setInput({ color, draft: color, invalid: false });
            }
          }}
        />
      </div>
      {input.invalid && (
        <p className="document-appearance-color-error" id={errorId} role="alert">
          {t('Use a hex color, like #6750a4.')}
        </p>
      )}
    </div>
  );
}

function AppearanceDefault({
  label,
  text,
  onReset,
}: {
  label: string;
  text: string;
  onReset: () => void;
}) {
  return (
    <RadioGroup.Item
      className="document-appearance-default"
      value="inherit"
      aria-label={label}
      onClick={onReset}
    >
      <span className="document-appearance-default-check">
        <RadioGroup.Indicator>
          <CheckIcon weight="regular" size={14} aria-hidden="true" />
        </RadioGroup.Indicator>
      </span>
      {text}
    </RadioGroup.Item>
  );
}

function AppearanceSwatch({
  value,
  label,
  color,
  ink = '#1c1b1a',
  onSelect,
}: {
  value: string;
  label: string;
  color: string;
  ink?: string;
  onSelect: () => void;
}) {
  return (
    <RadioGroup.Item
      className="document-appearance-swatch"
      value={value}
      aria-label={label}
      title={label}
      onClick={onSelect}
    >
      <span
        className="document-appearance-swatch-color"
        style={{ backgroundColor: color, color: ink }}
      >
        <RadioGroup.Indicator className="document-appearance-swatch-check">
          <CheckIcon weight="regular" size={18} aria-hidden="true" />
        </RadioGroup.Indicator>
      </span>
    </RadioGroup.Item>
  );
}
