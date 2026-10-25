'use client';

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { TextTIcon } from '@phosphor-icons/react/dist/ssr/TextT';
import { TextHOneIcon } from '@phosphor-icons/react/dist/ssr/TextHOne';
import { TextHTwoIcon } from '@phosphor-icons/react/dist/ssr/TextHTwo';
import { TextHThreeIcon } from '@phosphor-icons/react/dist/ssr/TextHThree';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/ssr/MagnifyingGlass';
import { ListBulletsIcon } from '@phosphor-icons/react/dist/ssr/ListBullets';
import { ListNumbersIcon } from '@phosphor-icons/react/dist/ssr/ListNumbers';
import { QuotesIcon } from '@phosphor-icons/react/dist/ssr/Quotes';
import { CodeBlockIcon } from '@phosphor-icons/react/dist/ssr/CodeBlock';
import { MinusIcon } from '@phosphor-icons/react/dist/ssr/Minus';
import { LinkIcon } from '@phosphor-icons/react/dist/ssr/Link';
import { FolderIcon } from '@phosphor-icons/react/dist/ssr/Folder';
import { GameControllerIcon } from '@phosphor-icons/react/dist/ssr/GameController';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/ssr/DiscordLogo';
import { TextColumnsIcon } from '@phosphor-icons/react/dist/ssr/TextColumns';
import { GifIcon } from '@phosphor-icons/react/dist/ssr/Gif';
import { StickerIcon } from '@phosphor-icons/react/dist/ssr/Sticker';
import type { createTranslator } from '@/lib/i18n/translate';

type Translator = ReturnType<typeof createTranslator>;
const choices = [
  { id: 'text', label: 'Text', detail: 'Start writing a paragraph.', icon: TextTIcon },
  { id: 'heading1', label: 'Heading 1', detail: 'A large heading.', icon: TextHOneIcon },
  { id: 'heading2', label: 'Heading 2', detail: 'A medium heading.', icon: TextHTwoIcon },
  { id: 'heading3', label: 'Heading 3', detail: 'A small heading.', icon: TextHThreeIcon },
  {
    id: 'bulletList',
    label: 'Bullet list',
    detail: 'A simple list of ideas.',
    icon: ListBulletsIcon,
  },
  { id: 'orderedList', label: 'Numbered list', detail: 'Steps in order.', icon: ListNumbersIcon },
  { id: 'blockquote', label: 'Quote', detail: 'Highlight a quote.', icon: QuotesIcon },
  { id: 'codeBlock', label: 'Code block', detail: 'Show a code snippet.', icon: CodeBlockIcon },
  { id: 'divider', label: 'Divider', detail: 'Separate parts of your page.', icon: MinusIcon },
  { id: 'gif', label: 'GIF', detail: 'Add a GIF from GIPHY or Tenor.', icon: GifIcon },
  {
    id: 'p5',
    label: 'p5.js sketch',
    detail: 'Embed a live sketch hosted on p5.js.',
    icon: CodeBlockIcon,
  },
  { id: 'badge', label: 'Badge', detail: 'Classic web badges and Shields.io.', icon: StickerIcon },
  {
    id: 'link',
    label: 'Link card',
    detail: 'Add a link card.',
    icon: LinkIcon,
    wya: true,
  },
  {
    id: 'project',
    label: 'Project',
    detail: 'Share something you made.',
    icon: FolderIcon,
    wya: true,
  },
  {
    id: 'game',
    label: 'Game',
    detail: 'Share a game you enjoy.',
    icon: GameControllerIcon,
    wya: true,
  },
  {
    id: 'collection',
    label: 'Collection',
    detail: 'Group related cards together.',
    icon: SquaresFourIcon,
    wya: true,
  },
  {
    id: 'discord',
    label: 'Discord server',
    detail: 'Show your server widget.',
    icon: DiscordLogoIcon,
    wya: true,
  },
  {
    id: 'section',
    label: 'Section',
    detail: 'Give a group of blocks a title.',
    icon: TextColumnsIcon,
    wya: true,
  },
] as const;
export type BlockKind = (typeof choices)[number]['id'];
export type BlockChoice = {
  id: BlockKind;
  label: string;
  detail: string;
  icon: typeof TextTIcon;
  wya: boolean;
};

function searchText(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

export function blockChoices(t: Translator, wya: boolean, query = ''): BlockChoice[] {
  const search = searchText(query.trim());
  return choices
    .filter(
      (choice) =>
        (wya || !('wya' in choice)) &&
        searchText(`${choice.label} ${t(choice.label)} ${t(choice.detail)}`).includes(search),
    )
    .map((choice) => ({
      ...choice,
      wya: 'wya' in choice,
      label: t(choice.label),
      detail: t(choice.detail),
    }));
}

export type BlockMenuHandle = { onKeyDown: (event: KeyboardEvent) => boolean };
export type BlockMenuAccessibility = { listId: string; activeId?: string };

/** The same choices and keyboard behavior serve both the + and slash menus. */
export const BlockMenu = forwardRef<
  BlockMenuHandle,
  {
    items: BlockChoice[];
    onChoose: (kind: BlockKind) => void;
    t: Translator;
    query?: string;
    onQuery?: (query: string) => void;
    onActiveChange?: (state: BlockMenuAccessibility) => void;
  }
>(function BlockMenu({ items, onChoose, t, query, onQuery, onActiveChange }, ref) {
  const [selected, setSelected] = useState<BlockKind | null>(null);
  const active = items.findIndex((item) => item.id === selected);
  const index = active < 0 ? 0 : active;
  const listId = `rich-blocks-${useId()}`;
  const optionId = (kind: BlockKind) => `${listId}-${kind}`;
  const activeId = items[index] ? optionId(items[index].id) : undefined;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = list.current;
    const option = viewport?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!viewport || !option) return;
    // Keep keyboard selection visible without scrolling the OS window behind
    // this popup, including while Floating UI is positioning it on mobile.
    const top =
      option.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top +
      viewport.scrollTop -
      viewport.clientTop;
    const bottom = top + option.offsetHeight;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (bottom > viewport.scrollTop + viewport.clientHeight)
      viewport.scrollTop = bottom - viewport.clientHeight;
  }, [activeId]);
  useEffect(() => {
    onActiveChange?.({ listId, activeId });
  }, [onActiveChange, listId, activeId]);
  function onKeyDown(
    event: Pick<KeyboardEvent, 'key' | 'preventDefault' | 'target'> & {
      isComposing?: boolean;
      nativeEvent?: { isComposing?: boolean };
    },
  ) {
    if (!items.length || event.isComposing || event.nativeEvent?.isComposing) return false;
    const target = event.target as HTMLElement | null;
    const focusedIndex = items.findIndex(
      (item) => target?.getAttribute?.('data-block-kind') === item.id,
    );
    const current = focusedIndex < 0 ? index : focusedIndex;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      setSelected(items[next].id);
      if (focusedIndex >= 0)
        list.current
          ?.querySelectorAll<HTMLButtonElement>('[role="option"]')
          [next]?.focus({ preventScroll: true });
      return true;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onChoose(items[current].id);
      return true;
    }
    return false;
  }
  useImperativeHandle(ref, () => ({ onKeyDown }));
  return (
    <div className="rich-block-menu" onKeyDown={onKeyDown}>
      {onQuery ? (
        <div className="rich-block-search-row">
          <MagnifyingGlassIcon size={18} aria-hidden="true" />
          <input
            className="rich-block-search"
            aria-label={t('Search blocks')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            placeholder={t('Search blocks…')}
            value={query}
            onChange={(event) => {
              setSelected(null);
              onQuery(event.target.value);
            }}
          />
        </div>
      ) : (
        <div className="rich-block-menu-title">{t('Add content')}</div>
      )}
      <div
        className="rich-block-menu-list"
        id={listId}
        role="listbox"
        aria-label={t('Content blocks')}
        ref={list}
      >
        {items.map((item, itemIndex) => (
          <div key={item.id}>
            {(itemIndex === 0 || item.wya !== items[itemIndex - 1].wya) && (
              <p className="rich-block-menu-group">
                {item.wya ? t('Wya blocks') : t('Basic blocks')}
              </p>
            )}
            <button
              type="button"
              id={optionId(item.id)}
              data-block-kind={item.id}
              role="option"
              aria-selected={index === itemIndex}
              aria-describedby={`${optionId(item.id)}-detail`}
              tabIndex={index === itemIndex ? 0 : -1}
              onFocus={() => setSelected(item.id)}
              onMouseEnter={() => setSelected(item.id)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChoose(item.id)}
            >
              <span className="rich-block-menu-icon">
                <item.icon aria-hidden="true" size={20} />
              </span>
              <span className="rich-block-menu-label">{item.label}</span>
              <span id={`${optionId(item.id)}-detail`} hidden>
                {item.detail}
              </span>
            </button>
          </div>
        ))}
        {!items.length && (
          <p className="rich-block-menu-empty" role="status">
            {t('No matching blocks.')}
          </p>
        )}
      </div>
      {items.length > 0 && (
        <div className="rich-block-menu-detail" aria-hidden="true">
          {items[index].detail}
        </div>
      )}
    </div>
  );
});
