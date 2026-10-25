'use client';

import { useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { DropdownMenu } from 'radix-ui';
import { CaretDownIcon } from '@phosphor-icons/react/dist/ssr/CaretDown';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { TextAaIcon } from '@phosphor-icons/react/dist/ssr/TextAa';
import { fontIds, profileFonts, type ProfileFont } from '@/lib/profile-fonts';
import { getRichFontSelection, setRichFont } from '@/lib/rich-document-fonts';
import { useTranslation } from '../language-provider';

/** Read the same inherited stacks the document renders, including live file overrides. */
function documentFontDefaults(editor: Editor) {
  const style = getComputedStyle(editor.view.dom);
  const normalize = (value: string) => value.replace(/[\s'"]/g, '').toLowerCase();
  function font(part: 'body' | 'heading'): ProfileFont {
    const stack =
      style.getPropertyValue(`--document-font-${part}`) ||
      style.getPropertyValue(`--space-font-${part}`);
    return (
      fontIds.find((id) => normalize(profileFonts[id][part]) === normalize(stack)) ?? 'original'
    );
  }
  return { bodyFont: font('body'), headingFont: font('heading') };
}

export function SelectionFontMenu({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const { t } = useTranslation();
  const snapshot = useRef(editor.state);
  const applied = useRef(false);
  const selection = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      getRichFontSelection(current.state, documentFontDefaults(current)),
  });
  const label = selection.font ? t(profileFonts[selection.font].label) : '';
  const value = selection.mixed ? '' : selection.inherited ? 'inherit' : (selection.font ?? '');

  return (
    <div className="rich-selection-style rich-selection-font">
      <DropdownMenu.Root
        modal={false}
        onOpenChange={(open) => {
          if (open) {
            snapshot.current = editor.state;
            applied.current = false;
          }
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="rich-style-trigger"
            aria-label={selection.mixed ? t('Font (mixed)') : `${t('Font')}: ${label}`}
            title={selection.mixed ? t('Mixed fonts') : `${t('Font')}: ${label}`}
            disabled={disabled || !selection.enabled}
            data-mixed={selection.mixed || undefined}
          >
            <span className="rich-font-preview" aria-hidden="true">
              {selection.mixed ? '\u00a0' : <TextAaIcon size={18} />}
            </span>
            <CaretDownIcon size={12} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        {/* Keep the picker inside the selection menu so focus retains the text range. */}
        <DropdownMenu.Content
          className="rich-style-options rich-font-options"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            if (applied.current) event.preventDefault();
          }}
        >
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(font) => {
              applied.current = setRichFont(
                editor,
                font === 'inherit' ? null : (font as ProfileFont),
                snapshot.current,
              );
              if (applied.current) editor.commands.focus();
            }}
          >
            <DropdownMenu.RadioItem value="inherit" className="rich-style-option">
              <span>{t('Document default')}</span>
              <DropdownMenu.ItemIndicator>
                <CheckIcon size={16} aria-hidden="true" />
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
            {fontIds.map((font) => (
              <DropdownMenu.RadioItem key={font} value={font} className="rich-style-option">
                <span style={{ fontFamily: profileFonts[font].body }}>
                  {t(profileFonts[font].label)}
                </span>
                <DropdownMenu.ItemIndicator>
                  <CheckIcon size={16} aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}
