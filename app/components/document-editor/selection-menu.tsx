'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { posToDOMRect, type Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu, type BubbleMenuProps } from '@tiptap/react/menus';
import { DropdownMenu } from 'radix-ui';
import { CaretDownIcon } from '@phosphor-icons/react/dist/ssr/CaretDown';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { TextBIcon } from '@phosphor-icons/react/dist/ssr/TextB';
import { TextItalicIcon } from '@phosphor-icons/react/dist/ssr/TextItalic';
import { TextStrikethroughIcon } from '@phosphor-icons/react/dist/ssr/TextStrikethrough';
import { CodeIcon } from '@phosphor-icons/react/dist/ssr/Code';
import { LinkIcon } from '@phosphor-icons/react/dist/ssr/Link';
import { TextTIcon } from '@phosphor-icons/react/dist/ssr/TextT';
import { ListBulletsIcon } from '@phosphor-icons/react/dist/ssr/ListBullets';
import { ListNumbersIcon } from '@phosphor-icons/react/dist/ssr/ListNumbers';
import { QuotesIcon } from '@phosphor-icons/react/dist/ssr/Quotes';
import { CodeBlockIcon } from '@phosphor-icons/react/dist/ssr/CodeBlock';
import { fileLinkUrl } from '@/lib/space-files';
import { setRichTextStyle, type RichTextStyle } from '@/lib/rich-document-formatting';
import { useTranslation } from '../language-provider';
import { SelectionFontMenu } from './selection-font-menu';

const menuKey = 'wyaTextFormatting';
const appendTo = () => document.body;
const options = {
  placement: 'bottom-start' as const,
  strategy: 'fixed' as const,
  offset: 12,
  // Tiptap applies offset after collision handling. Reserve the gap at both edges.
  flip: { padding: 24, altBoundary: true },
  shift: { padding: 12, altBoundary: true },
  hide: true,
};
const textStyleIcons = {
  paragraph: TextTIcon,
  bulletList: ListBulletsIcon,
  orderedList: ListNumbersIcon,
  blockquote: QuotesIcon,
  codeBlock: CodeBlockIcon,
};
const markCommands = [
  { label: 'Bold', icon: TextBIcon, mark: 'bold', shortcut: 'B', command: 'toggleBold' },
  { label: 'Italic', icon: TextItalicIcon, mark: 'italic', shortcut: 'I', command: 'toggleItalic' },
  {
    label: 'Strikethrough',
    icon: TextStrikethroughIcon,
    mark: 'strike',
    shortcut: 'Shift+S',
    command: 'toggleStrike',
  },
  { label: 'Inline code', icon: CodeIcon, mark: 'code', shortcut: 'E', command: 'toggleCode' },
] as const;

function canLink(editor: Editor) {
  return (
    editor.state.selection instanceof TextSelection &&
    editor.can().setLink({ href: 'https://example.com' })
  );
}

export function SelectionMenu({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const { t } = useTranslation();
  const menu = useRef<HTMLDivElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const styleSelection = useRef(editor.state);
  const styleApplied = useRef(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState('');
  const formatting = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      style:
        ['codeBlock', 'bulletList', 'orderedList', 'blockquote'].find((name) =>
          current.isActive(name),
        ) ??
        [1, 2, 3, 4, 5, 6].find((level) => current.isActive('heading', { level }))?.toString() ??
        (current.isActive('paragraph') ? 'paragraph' : ''),
      marks: markCommands.map(({ mark, command }) => ({
        active: current.isActive(mark),
        enabled: current.can()[command](),
      })),
      linkActive: current.isActive('link'),
      linkEnabled: canLink(current),
    }),
  });
  const styles = [
    { value: 'paragraph', label: t('Text') },
    ...[1, 2, 3, 4, 5, 6].map((level) => ({
      value: String(level),
      label: `${t('Heading')} ${level}`,
    })),
    { value: 'bulletList', label: t('Bullet list') },
    { value: 'orderedList', label: t('Numbered list') },
    { value: 'blockquote', label: t('Quote') },
    { value: 'codeBlock', label: t('Code block') },
  ];
  const styleLabel =
    styles.find(({ value }) => value === formatting.style)?.label ?? t('Text style');
  const StyleIcon = textStyleIcons[formatting.style as keyof typeof textStyleIcons] ?? TextTIcon;
  const headingLevel = /^[1-6]$/.test(formatting.style) ? formatting.style : null;
  const selectionAnchor = useCallback(
    () => ({
      contextElement: editor.view.dom,
      getBoundingClientRect: () =>
        posToDOMRect(editor.view, editor.state.selection.from, editor.state.selection.to),
    }),
    [editor],
  );
  const shouldShow = useCallback<NonNullable<BubbleMenuProps['shouldShow']>>(
    ({ state, view, element }) =>
      !disabled &&
      (view.hasFocus() || element.contains(document.activeElement)) &&
      state.selection instanceof TextSelection &&
      (linkOpen ||
        (!state.selection.empty &&
          !!state.doc.textBetween(state.selection.from, state.selection.to).trim())),
    [disabled, linkOpen],
  );
  const openLink = useCallback(() => {
    if (!canLink(editor)) return;
    setLinkUrl(editor.getAttributes('link').href ?? '');
    setLinkError('');
    setLinkOpen(true);
  }, [editor]);
  const dismissOutside = useCallback(
    (relatedTarget: EventTarget | null) => {
      // During blur, activeElement can still be the body. Use the destination
      // to keep input -> button focus moves from removing the form before click.
      if (
        relatedTarget instanceof Node &&
        (menu.current?.contains(relatedTarget) || editor.view.dom.contains(relatedTarget))
      )
        return;
      // Removing a focused BubbleMenu emits blur synchronously. Defer genuine
      // outside dismissal so it cannot re-enter the plugin's DOM removal.
      queueMicrotask(() => {
        if (
          editor.isDestroyed ||
          editor.view.hasFocus() ||
          menu.current?.contains(document.activeElement)
        )
          return;
        setLinkOpen(false);
        setLinkError('');
        if (menu.current?.isConnected) editor.commands.setMeta(menuKey, 'hide');
      });
    },
    [editor],
  );

  useEffect(() => {
    const dom = editor.view.dom;
    function onKeyDown(event: KeyboardEvent) {
      if (disabled || event.isComposing || event.repeat) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        event.stopPropagation();
        openLink();
      } else if (event.altKey && event.key === 'F10' && menu.current?.isConnected) {
        event.preventDefault();
        menu.current.querySelector<HTMLElement>('select, input, button')?.focus();
      } else if (event.key === 'Escape' && menu.current?.isConnected) {
        event.preventDefault();
        event.stopPropagation();
        setLinkOpen(false);
        editor.commands.setTextSelection(editor.state.selection.to);
        editor.commands.setMeta(menuKey, 'hide');
      }
    }
    // Formatting marks use Tiptap's native keymaps. Only the link UI needs a handler.
    dom.addEventListener('keydown', onKeyDown, true);
    const resetLink = () => {
      setLinkOpen(false);
      setLinkError('');
    };
    editor.on('selectionUpdate', resetLink);
    const onEditorBlur = ({ event }: { event: FocusEvent }) => dismissOutside(event.relatedTarget);
    editor.on('blur', onEditorBlur);
    // EditorContent moves the DOM into its scroll container after the first render.
    // Capture ancestor scrolls after mounting so the body portal follows that container.
    const onScroll = () => {
      if (menu.current?.isConnected) editor.commands.setMeta(menuKey, 'updatePosition');
    };
    dom.ownerDocument.addEventListener('scroll', onScroll, true);
    return () => {
      dom.removeEventListener('keydown', onKeyDown, true);
      editor.off('selectionUpdate', resetLink);
      editor.off('blur', onEditorBlur);
      dom.ownerDocument.removeEventListener('scroll', onScroll, true);
    };
  }, [editor, disabled, openLink, dismissOutside]);

  useEffect(() => {
    if (disabled) {
      editor.commands.setMeta(menuKey, 'hide');
      return;
    }
    if (!linkOpen) {
      editor.commands.setMeta(menuKey, 'updatePosition');
      return;
    }
    // Also opens at a collapsed caret for Cmd/Ctrl+K. Keep the document selection
    // intact while the URL input receives focus.
    editor.commands.setMeta(menuKey, 'show');
    editor.commands.setMeta(menuKey, 'updatePosition');
    linkInput.current?.focus();
    linkInput.current?.select();
  }, [editor, disabled, linkOpen]);
  useEffect(() => {
    editor.commands.setMeta(menuKey, 'updatePosition');
  }, [editor, linkError]);

  return (
    <BubbleMenu
      ref={menu}
      editor={editor}
      pluginKey={menuKey}
      className="rich-selection-menu"
      role="group"
      aria-label={t('Text formatting')}
      appendTo={appendTo}
      options={options}
      shouldShow={shouldShow}
      getReferencedVirtualElement={selectionAnchor}
      updateDelay={100}
    >
      <div
        className={linkOpen ? undefined : 'rich-selection-toolbar'}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          setLinkOpen(false);
          editor.chain().focus().setTextSelection(editor.state.selection.to).run();
          editor.commands.setMeta(menuKey, 'hide');
        }}
        onBlur={(event) => dismissOutside(event.relatedTarget)}
      >
        {linkOpen ? (
          <form
            className="rich-link-form"
            onSubmit={(event) => {
              event.preventDefault();
              const href = fileLinkUrl(linkUrl.trim());
              if (linkUrl.trim() && !href) {
                setLinkError(t('Enter a valid link.'));
                return;
              }
              const chain = editor.chain().focus().extendMarkRange('link');
              if (!href) chain.unsetLink().run();
              else if (editor.state.selection.empty && !editor.isActive('link'))
                chain
                  .insertContent({
                    type: 'text',
                    text: href,
                    marks: [{ type: 'link', attrs: { href } }],
                  })
                  .run();
              else chain.setLink({ href }).run();
              setLinkOpen(false);
              editor.commands.setMeta(menuKey, 'updatePosition');
            }}
          >
            <label>
              {t('Text link')}
              <input
                ref={linkInput}
                value={linkUrl}
                placeholder="https://"
                onChange={(event) => setLinkUrl(event.target.value)}
                aria-invalid={!!linkError}
              />
            </label>
            {linkError && <p role="alert">{linkError}</p>}
            <div className="rich-link-actions">
              <button type="submit">{t('Apply')}</button>
              {editor.isActive('link') && (
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().extendMarkRange('link').unsetLink().run();
                    setLinkOpen(false);
                  }}
                >
                  {t('Remove link')}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setLinkOpen(false);
                  editor.commands.focus();
                }}
              >
                {t('Cancel')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="rich-selection-selectors">
              <div className="rich-selection-style">
                <DropdownMenu.Root
                  modal={false}
                  onOpenChange={(open) => {
                    if (open) {
                      styleSelection.current = editor.state;
                      styleApplied.current = false;
                    }
                  }}
                >
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className="rich-style-trigger"
                      aria-label={`${t('Text style')}: ${styleLabel}`}
                      title={styleLabel}
                    >
                      {headingLevel ? (
                        <span className="rich-style-heading" aria-hidden="true">
                          H<sub>{headingLevel}</sub>
                        </span>
                      ) : (
                        <StyleIcon size={18} aria-hidden="true" />
                      )}
                      <CaretDownIcon size={12} aria-hidden="true" />
                    </button>
                  </DropdownMenu.Trigger>
                  {/* Keep focus inside BubbleMenu while navigating the type picker. */}
                  <DropdownMenu.Content
                    className="rich-style-options"
                    align="start"
                    sideOffset={6}
                    collisionPadding={12}
                    onEscapeKeyDown={(event) => event.stopPropagation()}
                    onCloseAutoFocus={(event) => {
                      if (styleApplied.current) event.preventDefault();
                    }}
                  >
                    <DropdownMenu.RadioGroup
                      value={formatting.style}
                      onValueChange={(value) => {
                        if (value === formatting.style) return;
                        styleApplied.current = setRichTextStyle(
                          editor,
                          value as RichTextStyle,
                          styleSelection.current,
                        );
                        if (styleApplied.current) editor.commands.focus();
                      }}
                    >
                      {styles.map(({ value, label }) => (
                        <DropdownMenu.RadioItem
                          key={value}
                          value={value}
                          className="rich-style-option"
                        >
                          <span>{label}</span>
                          <DropdownMenu.ItemIndicator>
                            <CheckIcon size={16} aria-hidden="true" />
                          </DropdownMenu.ItemIndicator>
                        </DropdownMenu.RadioItem>
                      ))}
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </div>
              <SelectionFontMenu editor={editor} disabled={disabled} />
            </div>
            <div className="rich-selection-marks">
              {markCommands.map(({ label, icon: Icon, mark, shortcut, command }, index) => (
                <button
                  key={mark}
                  type="button"
                  aria-label={t(label)}
                  title={`${t(label)} · ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'}${shortcut}`}
                  aria-pressed={formatting.marks[index].active}
                  disabled={!formatting.marks[index].enabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => editor.chain().focus()[command]().run()}
                >
                  <Icon size={18} aria-hidden="true" />
                </button>
              ))}
              <button
                type="button"
                aria-label={t('Text link')}
                title={t('Text link')}
                aria-pressed={formatting.linkActive}
                disabled={!formatting.linkEnabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={openLink}
              >
                <LinkIcon size={18} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
