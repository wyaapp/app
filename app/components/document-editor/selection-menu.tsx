'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { posToDOMRect, type Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { BubbleMenu, type BubbleMenuProps } from '@tiptap/react/menus';
import { TextBIcon } from '@phosphor-icons/react/dist/ssr/TextB';
import { TextItalicIcon } from '@phosphor-icons/react/dist/ssr/TextItalic';
import { TextStrikethroughIcon } from '@phosphor-icons/react/dist/ssr/TextStrikethrough';
import { CodeIcon } from '@phosphor-icons/react/dist/ssr/Code';
import { LinkIcon } from '@phosphor-icons/react/dist/ssr/Link';
import { fileLinkUrl } from '@/lib/space-files';
import { useTranslation } from '../language-provider';

const menuKey = 'wyaTextFormatting';
const appendTo = () => document.body;
const options = {
  placement: 'top' as const,
  strategy: 'fixed' as const,
  offset: 8,
  flip: { padding: 12 },
  shift: { padding: 12 },
  hide: true,
};

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
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState('');
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
  const dismissOutside = useCallback(() => {
    // Removing a focused BubbleMenu emits blur synchronously. Defer dismissal
    // so it cannot re-enter the plugin's DOM removal halfway through hiding.
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
  }, [editor]);

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
    editor.on('blur', dismissOutside);
    // EditorContent moves the DOM into its scroll container after the first render.
    // Capture ancestor scrolls after mounting so the body portal follows that container.
    const onScroll = () => {
      if (menu.current?.isConnected) editor.commands.setMeta(menuKey, 'updatePosition');
    };
    dom.ownerDocument.addEventListener('scroll', onScroll, true);
    return () => {
      dom.removeEventListener('keydown', onKeyDown, true);
      editor.off('selectionUpdate', resetLink);
      editor.off('blur', dismissOutside);
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

  const commands = [
    {
      label: 'Bold',
      icon: TextBIcon,
      mark: 'bold',
      shortcut: 'B',
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      icon: TextItalicIcon,
      mark: 'italic',
      shortcut: 'I',
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Strikethrough',
      icon: TextStrikethroughIcon,
      mark: 'strike',
      shortcut: 'Shift+S',
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: 'Inline code',
      icon: CodeIcon,
      mark: 'code',
      shortcut: 'E',
      run: () => editor.chain().focus().toggleCode().run(),
    },
  ];
  const style =
    ['codeBlock', 'bulletList', 'orderedList', 'blockquote'].find((name) =>
      editor.isActive(name),
    ) ?? (editor.isActive('heading') ? String(editor.getAttributes('heading').level) : 'paragraph');

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
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          setLinkOpen(false);
          editor.chain().focus().setTextSelection(editor.state.selection.to).run();
          editor.commands.setMeta(menuKey, 'hide');
        }}
        onBlur={dismissOutside}
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
            <div className="rich-selection-style">
              <select
                aria-label={t('Text style')}
                value={style}
                onChange={(event) => {
                  const value = event.target.value;
                  const chain = editor.chain().focus();
                  if (value === 'paragraph') chain.clearNodes().setParagraph().run();
                  else if (value === 'bulletList') chain.toggleBulletList().run();
                  else if (value === 'orderedList') chain.toggleOrderedList().run();
                  else if (value === 'blockquote') chain.toggleBlockquote().run();
                  else if (value === 'codeBlock') chain.toggleCodeBlock().run();
                  else
                    chain
                      .clearNodes()
                      .setHeading({ level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 })
                      .run();
                }}
              >
                <option value="paragraph">{t('Text')}</option>
                {[1, 2, 3, 4, 5, 6].map((level) => (
                  <option key={level} value={level}>
                    {t('Heading')} {level}
                  </option>
                ))}
                <option value="bulletList">{t('Bullet list')}</option>
                <option value="orderedList">{t('Numbered list')}</option>
                <option value="blockquote">{t('Quote')}</option>
                <option value="codeBlock">{t('Code block')}</option>
              </select>
            </div>
            <div className="rich-selection-marks">
              {commands.map(({ label, icon: Icon, mark, shortcut, run }) => (
                <button
                  key={mark}
                  type="button"
                  aria-label={t(label)}
                  title={`${t(label)} · ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'}${shortcut}`}
                  aria-pressed={editor.isActive(mark)}
                  disabled={
                    !editor
                      .can()
                      [
                        mark === 'bold'
                          ? 'toggleBold'
                          : mark === 'italic'
                            ? 'toggleItalic'
                            : mark === 'strike'
                              ? 'toggleStrike'
                              : 'toggleCode'
                      ]()
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={run}
                >
                  <Icon size={18} aria-hidden="true" />
                </button>
              ))}
              <button
                type="button"
                aria-label={t('Text link')}
                title={t('Text link')}
                aria-pressed={editor.isActive('link')}
                disabled={!canLink(editor)}
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
