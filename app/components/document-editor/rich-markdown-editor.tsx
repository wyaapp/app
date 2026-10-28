'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type ReactNode,
} from 'react';
import type { Editor, Range } from '@tiptap/core';
import { flushSync } from 'react-dom';
import Placeholder from '@tiptap/extension-placeholder';
import DragHandle from '@tiptap/extension-drag-handle-react';
import type { NestedOptions } from '@tiptap/extension-drag-handle';
import { closeHistory } from '@tiptap/pm/history';
import { NodeSelection } from '@tiptap/pm/state';
import { Popover, DropdownMenu } from 'radix-ui';
import { DotsSixVerticalIcon } from '@phosphor-icons/react/dist/ssr/DotsSixVertical';
import { BlockMenu, blockChoices, type BlockKind } from './block-menu';
import { SelectionMenu } from './selection-menu';
import { GifPicker } from './gif-picker';
import { GifBlock, GifSizeMenu } from './gif-block';
import { ImageBlock, ImageSizeMenu } from './image-block';
import { P5Picker } from './p5-picker';
import { P5EmbedView } from '../p5-embed';
import { normalizeP5Embed, type P5Embed } from '@/lib/p5';
import { createP5Paste } from '@/lib/rich-document-p5';
import { BadgePicker } from './badge-picker';
import { BadgeEmbedView } from '../badge-embed';
import { normalizeBadgeEmbed, type BadgeEmbed } from '@/lib/badge';
import { createBadgePaste, insertRichBadge } from '@/lib/rich-document-badges';
import { createMediaPaste, mediaBlockToLink, mediaBlockUrl } from '@/lib/rich-document-media-paste';
import { createBlockClipboard } from '@/lib/rich-document-clipboard';
import { createSectionMigration } from '@/lib/rich-document-sections';
import {
  createWidgetDocumentConstraint,
  richBlockWidgetSource,
  WIDGET_BLOCK_CHOICES,
  WIDGET_EDITOR_ERROR,
} from '@/lib/rich-document-widgets';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { createBlockDragging, blockDragKey } from './block-drag';
import { createBlockSelection } from './block-selection';
import { activeRichBlock, createBlockFocus, blockFocusKey } from './block-focus';
import { TouchBlockHandle } from './touch-block-handle';
import { PlusIcon } from '@phosphor-icons/react/dist/ssr/Plus';
import {
  moveRichBlock,
  siblingRichBlockTarget,
  richBlockAt,
  type RichBlock,
} from '@/lib/rich-document-drag';
import type { GifEmbed } from '@/lib/gif';
import type { ImageEmbed } from '@/lib/image';
import { LinkIcon } from '@phosphor-icons/react/dist/ssr/Link';
import { CaretRightIcon } from '@phosphor-icons/react/dist/ssr/CaretRight';
import { ArrowsDownUpIcon } from '@phosphor-icons/react/dist/ssr/ArrowsDownUp';
import { createSlashCommands } from './slash-commands';
import { createInsertionGaps } from './insertion-gaps';
import { insertRichBlock, RICH_CARET_TRANSACTION } from '@/lib/rich-document-insertion';
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from '@tiptap/react';
import { createRichDocumentExtensions } from '@/lib/rich-document-schema';
import { ArrowDownIcon } from '@phosphor-icons/react/dist/ssr/ArrowDown';
import { ArrowUpIcon } from '@phosphor-icons/react/dist/ssr/ArrowUp';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { TrashIcon } from '@phosphor-icons/react/dist/ssr/Trash';
import { markdownToRichDocument, richDocumentToMarkdown } from '@/lib/rich-document';
import type { LinkItem, Profile } from '@/lib/profile-types';
import { ProfileItem } from '../profile-item';
import { useTranslation } from '../language-provider';

export type WyaBlockKind = 'link' | 'project' | 'game' | 'collection' | 'discord';
export type RichPageBlock = { kind: 'item'; id: string };
type PageMoveControls = {
  moveTargets?: { id: string; title: string }[];
  onMoveBlock?: (block: RichPageBlock, targetId: string) => Promise<boolean>;
  moveDisabled?: boolean;
};
type CardControls = {
  scope: string;
  profile: Profile;
  onEdit: (item: LinkItem, apply: (item: LinkItem) => void, restoreEditor: () => void) => void;
  onInsert: (
    kind: WyaBlockKind,
    apply: (item: LinkItem) => void,
    restoreEditor: () => void,
  ) => void;
};
type RichMarkdownEditorProps = PageMoveControls & {
  source: string;
  onChange: (source: string) => void;
  disabled?: boolean;
  cards?: CardControls;
  preserveUnknown?: boolean;
  widgetOnly?: boolean;
  onCreateWidget?: (source: string) => Promise<void>;
};
const CardContext = createContext<
  PageMoveControls & {
    cards?: CardControls;
    disabled: boolean;
    onAdd: (pos: number, anchor: HTMLElement) => void;
    onEditCard: (editor: Editor, block: RichBlock) => void;
    onEditBadge: (editor: Editor, pos: number, anchor: HTMLElement) => void;
    onEditP5: (editor: Editor, pos: number, anchor: HTMLElement) => void;
    editingCardPos: number | null;
    widgetOnly?: boolean;
    onCreateWidget?: (source: string) => Promise<void>;
  }
>({
  disabled: false,
  onAdd: () => {},
  onEditCard: () => {},
  onEditBadge: () => {},
  onEditP5: () => {},
  editingCardPos: null,
});

type BlockActionProps = Pick<NodeViewProps, 'editor' | 'getPos' | 'node'> & {
  onEdit?: () => void;
  children?: ReactNode;
  floating?: boolean;
};

function BlockActions(props: BlockActionProps) {
  const { t } = useTranslation();
  const {
    disabled: surfaceDisabled,
    onAdd,
    moveTargets,
    onMoveBlock,
    moveDisabled,
    widgetOnly,
    onCreateWidget,
  } = useContext(CardContext);
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  const returnToBlock = useRef(false);
  const disabled = surfaceDisabled || moving || copying;
  const widgetSource =
    onCreateWidget && !widgetOnly ? richBlockWidgetSource(props.node.toJSON()) : null;
  async function copyWidget() {
    if (!onCreateWidget || widgetSource === null || disabled) return;
    setCopying(true);
    setCopyError('');
    try {
      await onCreateWidget(widgetSource);
      returnToBlock.current = false;
      changeOpen(false);
    } catch (cause) {
      setCopyError(
        cause instanceof Error ? cause.message : 'Could not create the widget. Please try again.',
      );
    } finally {
      setCopying(false);
    }
  }
  const pos = props.getPos();
  const before = pos === undefined ? null : siblingRichBlockTarget(props.editor.state, pos, -1);
  const after = pos === undefined ? null : siblingRichBlockTarget(props.editor.state, pos, 1);
  const movable: RichPageBlock | null =
    props.node.type.name === 'wyaItem' && props.node.attrs.item?.slug
      ? { kind: 'item', id: props.node.attrs.item.slug }
      : null;
  async function moveToPage(targetId: string) {
    if (!movable || !onMoveBlock || disabled || moveDisabled) return;
    setMoving(true);
    setMoveError(false);
    try {
      if (await onMoveBlock(movable, targetId)) {
        returnToBlock.current = false;
        changeOpen(false);
        if (!props.editor.isDestroyed) props.editor.view.focus();
      } else setMoveError(true);
    } catch {
      setMoveError(true);
    } finally {
      setMoving(false);
    }
  }
  function selectBlock() {
    if (disabled || props.editor.isDestroyed || !props.editor.isEditable) return false;
    const from = props.getPos();
    if (from === undefined) return false;
    const { state, view } = props.editor;
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, from)));
    return true;
  }
  function changeOpen(next: boolean) {
    if (next) {
      returnToBlock.current = true;
      selectBlock();
    }
    setOpen(next);
    if (!props.editor.isDestroyed)
      props.editor.commands.setMeta(blockFocusKey, {
        hover: next ? (props.getPos() ?? null) : null,
      });
    if (props.floating && !props.editor.isDestroyed)
      props.editor.commands.setMeta('lockDragHandle', next);
  }
  function move(direction: -1 | 1) {
    returnToBlock.current = false;
    const from = props.getPos();
    if (from === undefined || disabled || !props.editor.isEditable) return;
    const { state, view } = props.editor;
    const target = siblingRichBlockTarget(state, from, direction);
    const tr = target === null ? null : moveRichBlock(state, from, target);
    if (tr) {
      view.dispatch(tr.scrollIntoView());
      view.dispatch(closeHistory(props.editor.state.tr));
      view.focus();
    }
  }
  function handleClipboard(event: ReactClipboardEvent<HTMLElement>) {
    if (
      event.defaultPrevented ||
      (event.target instanceof HTMLElement &&
        (event.target.isContentEditable || event.target.closest('input, textarea, select'))) ||
      !selectBlock()
    )
      return;
    const view = props.editor.view;
    event.stopPropagation();
    returnToBlock.current = false;
    flushSync(() => changeOpen(false));
    view.focus();
    // OS menu commands can emit clipboard events without a keydown. Give the
    // original event to ProseMirror so its serializer, paste rules, and history
    // use the browser-provided clipboard data instead of the menu's DOM.
    view.dispatchEvent(event.nativeEvent);
  }
  return (
    <div
      className={`rich-block-actions ${props.floating ? 'rich-block-floating-actions' : 'rich-block-touch-actions'}`}
      data-block-type={props.node.type.name}
      contentEditable={false}
      onCopyCapture={handleClipboard}
      onCutCapture={handleClipboard}
      onPasteCapture={handleClipboard}
      onKeyDownCapture={(event) => {
        const key = event.key.toLowerCase();
        if (
          event.nativeEvent.isComposing ||
          !(event.metaKey || event.ctrlKey) ||
          event.altKey ||
          (event.shiftKey && key !== 'v') ||
          !['c', 'x', 'v'].includes(key) ||
          (event.target instanceof HTMLElement &&
            (event.target.isContentEditable || event.target.closest('input, textarea, select'))) ||
          !selectBlock()
        )
          return;
        returnToBlock.current = false;
        // Release Radix's modal focus scope before the native key default fires.
        flushSync(() => changeOpen(false));
        // Native clipboard events must target ProseMirror, not the portaled menu
        // or drag handle. Preserve the browser default; it owns clipboard access.
        props.editor.view.focus();
        event.stopPropagation();
      }}
    >
      <DropdownMenu.Root open={open} onOpenChange={changeOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="rich-block-handle"
            aria-label={t(props.floating ? 'Drag to move, click for options' : 'Block actions')}
            title={t(props.floating ? 'Drag to move, click for options' : 'Block actions')}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            disabled={disabled}
            // Radix normally opens on pointerdown, before native dragging can start.
            // Keep pointer defaults and open only after a click instead.
            onPointerDownCapture={(event) => event.stopPropagation()}
            onClick={() => changeOpen(!open)}
            onKeyDown={(event) => {
              if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();
                move(event.key === 'ArrowUp' ? -1 : 1);
              }
            }}
          >
            <DotsSixVerticalIcon size={18} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="rich-block-actions-menu"
            sideOffset={6}
            align="start"
            collisionPadding={12}
            onCopyCapture={handleClipboard}
            onCutCapture={handleClipboard}
            onPasteCapture={handleClipboard}
            onInteractOutside={() => {
              returnToBlock.current = false;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (returnToBlock.current && !props.editor.isDestroyed) props.editor.view.focus();
              returnToBlock.current = false;
            }}
          >
            {props.children}
            {props.node.type.name === 'paragraph' && props.node.content.size === 0 && (
              <DropdownMenu.Item
                onSelect={() => {
                  returnToBlock.current = false;
                  const pos = props.getPos();
                  const anchor = pos === undefined ? null : props.editor.view.nodeDOM(pos);
                  if (pos !== undefined && anchor instanceof HTMLElement) onAdd(pos, anchor);
                }}
              >
                <PlusIcon size={16} />
                {t('Add content')}
              </DropdownMenu.Item>
            )}
            {props.onEdit && (
              <DropdownMenu.Item
                onSelect={() => {
                  returnToBlock.current = false;
                  props.onEdit?.();
                }}
              >
                <PencilSimpleIcon size={16} />
                {t('Edit card')}
              </DropdownMenu.Item>
            )}
            {widgetSource !== null && (
              <DropdownMenu.Item
                disabled={disabled}
                onSelect={(event) => {
                  event.preventDefault();
                  void copyWidget();
                }}
              >
                <SquaresFourIcon size={16} />
                {t(copying ? 'Creating widget…' : 'Create widget copy')}
              </DropdownMenu.Item>
            )}
            {copyError && (
              <p className="rich-block-menu-notice" role="alert">
                {t(copyError)}
              </p>
            )}
            {!widgetOnly && (
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger>
                  <ArrowsDownUpIcon size={16} />
                  {t('Move block')}
                  <CaretRightIcon size={14} className="rich-block-menu-chevron" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    className="rich-block-actions-menu rich-block-move-menu"
                    sideOffset={4}
                    collisionPadding={12}
                    onCopyCapture={handleClipboard}
                    onCutCapture={handleClipboard}
                    onPasteCapture={handleClipboard}
                  >
                    <DropdownMenu.Item disabled={before === null} onSelect={() => move(-1)}>
                      <ArrowUpIcon size={16} />
                      {t('Move up')}
                      <kbd>Alt ↑</kbd>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item disabled={after === null} onSelect={() => move(1)}>
                      <ArrowDownIcon size={16} />
                      {t('Move down')}
                      <kbd>Alt ↓</kbd>
                    </DropdownMenu.Item>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            )}
            {movable && onMoveBlock && !!moveTargets?.length && (
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger disabled={disabled}>
                  <ArrowsDownUpIcon size={16} />
                  {t('Move to page')}
                  <CaretRightIcon size={14} className="rich-block-menu-chevron" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    className="rich-block-actions-menu rich-block-move-menu"
                    sideOffset={4}
                    collisionPadding={12}
                  >
                    {moveDisabled && (
                      <DropdownMenu.Label className="rich-block-menu-notice">
                        {t('Publish or discard this draft before moving content to another page.')}
                      </DropdownMenu.Label>
                    )}
                    {moveTargets.map((target) => (
                      <DropdownMenu.Item
                        key={target.id}
                        disabled={disabled || moveDisabled}
                        onSelect={(event) => {
                          event.preventDefault();
                          void moveToPage(target.id);
                        }}
                      >
                        {target.title}
                      </DropdownMenu.Item>
                    ))}
                    {moveError && (
                      <p className="rich-block-menu-notice" role="alert">
                        {t('Could not move this content. Please try again.')}
                      </p>
                    )}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            )}
            <DropdownMenu.Item
              disabled={disabled}
              onSelect={() => {
                returnToBlock.current = false;
                const from = props.getPos();
                if (from !== undefined && props.editor.isEditable)
                  props.editor
                    .chain()
                    .focus()
                    .deleteRange({ from, to: from + props.node.nodeSize })
                    .run();
              }}
            >
              <TrashIcon size={16} />
              {t('Remove block')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

const dragPosition = { placement: 'left-start' as const, strategy: 'absolute' as const };
const dragNesting: NestedOptions = {
  defaultRules: false,
  // Keep the same semantic block while the pointer crosses its bullet and gutter.
  // Edge scoring promotes the list wrapper just before the item grip is reached.
  edgeDetection: 'none',
  rules: [
    {
      id: 'documentBlocks',
      evaluate: ({ node, parent, isFirst }) =>
        node.isInline || (parent?.type.name === 'listItem' && isFirst) ? 1000 : 0,
    },
  ],
};

function BlockControls({
  editor,
  block,
  floating = false,
}: {
  editor: Editor;
  block: RichBlock;
  floating?: boolean;
}) {
  const { cards, disabled, onEditCard, widgetOnly } = useContext(CardContext);
  const { t } = useTranslation();
  const getPos = () =>
    !editor.isDestroyed && richBlockAt(editor.state.doc, block.pos)?.node === block.node
      ? block.pos
      : undefined;
  const apply = (attrs: Record<string, unknown>) => {
    const pos = getPos();
    if (pos !== undefined)
      editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, attrs));
  };
  return (
    <BlockActions
      editor={editor}
      node={block.node}
      getPos={getPos}
      floating={floating}
      onEdit={
        block.node.type.name === 'wyaItem' && cards ? () => onEditCard(editor, block) : undefined
      }
    >
      {block.node.type.name === 'gif' && (
        <GifSizeMenu
          gif={block.node.attrs.gif as GifEmbed}
          disabled={disabled}
          onChange={(size) => {
            const gif = { ...block.node.attrs.gif } as GifEmbed;
            if (size === undefined) delete gif.size;
            else gif.size = size;
            apply({ ...block.node.attrs, gif });
          }}
        />
      )}
      {block.node.type.name === 'image' && (
        <ImageSizeMenu
          image={{ ...(block.node.attrs as ImageEmbed), size: block.node.attrs.size ?? undefined }}
          disabled={disabled}
          onChange={(size) => apply({ ...block.node.attrs, size: size ?? null })}
        />
      )}
      {!widgetOnly && mediaBlockUrl(block.node) && (
        <DropdownMenu.Item
          disabled={disabled}
          onSelect={() => {
            const pos = getPos();
            if (pos === undefined || !editor.isEditable) return;
            const transaction = mediaBlockToLink(editor.state, pos);
            if (transaction) {
              editor.view.dispatch(transaction.scrollIntoView());
              editor.view.dispatch(closeHistory(editor.state.tr));
              editor.view.focus();
            }
          }}
        >
          <LinkIcon size={16} />
          {t('Convert to link')}
        </DropdownMenu.Item>
      )}
    </BlockActions>
  );
}

function DocumentBlockHandle({ editor }: { editor: Editor }) {
  const { disabled } = useContext(CardContext);
  const [current, setCurrent] = useState<RichBlock | null>(null);
  const currentRef = useRef<RichBlock | null>(null);
  const active = activeRichBlock(editor.state, editor.isEditable);
  useEffect(() => {
    if (disabled) editor.commands.setMeta('hideDragHandle', true);
    const keepItemTarget = (event: MouseEvent) => {
      const block = currentRef.current;
      if (
        !block ||
        block.node.type.name !== 'listItem' ||
        editor.isDestroyed ||
        !editor.isEditable ||
        editor.view.dom.hasAttribute('data-block-dragging') ||
        richBlockAt(editor.state.doc, block.pos)?.node !== block.node
      )
        return;
      const dom = editor.view.nodeDOM(block.pos);
      if (!(dom instanceof HTMLElement)) return;
      const row = dom.firstElementChild?.getBoundingClientRect();
      if (!row) return;
      const gutter =
        Number.parseFloat(getComputedStyle(editor.view.dom).getPropertyValue('--rich-gutter')) ||
        36;
      // posAtCoords can resolve the list wrapper over its first item's bullet.
      // Preserve the library's item target while crossing the gap to its grip;
      // do not let that mousemove retarget the handle to the entire list.
      if (
        event.clientX >= row.left - gutter &&
        event.clientX < row.left &&
        event.clientY >= row.top &&
        event.clientY <= row.bottom
      )
        event.stopPropagation();
    };
    const editorDOM = editor.view.dom;
    editorDOM.addEventListener('mousemove', keepItemTarget, true);
    const hide = (event: Event) => {
      if (editor.isDestroyed || editor.view.dom.hasAttribute('data-block-dragging')) return;
      const target = event.target;
      if (
        event.type === 'resize' ||
        (target instanceof Element && target.contains(editor.view.dom))
      )
        editor.commands.setMeta('hideDragHandle', true);
    };
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      editorDOM.removeEventListener('mousemove', keepItemTarget, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [editor, disabled]);
  const getPos = () => {
    const block = currentRef.current;
    return block &&
      !editor.isDestroyed &&
      richBlockAt(editor.state.doc, block.pos)?.node === block.node
      ? block.pos
      : undefined;
  };
  return (
    <>
      <DragHandle
        editor={editor}
        className="rich-block-drag-handle"
        computePositionConfig={dragPosition}
        nested={dragNesting}
        getReferencedVirtualElement={() => {
          const pos = getPos();
          const dom = pos === undefined ? null : editor.view.nodeDOM(pos);
          if (!(dom instanceof HTMLElement)) return null;
          return {
            getBoundingClientRect: () => {
              const box = dom.getBoundingClientRect();
              const content = editor.view.dom.getBoundingClientRect();
              const styles = getComputedStyle(editor.view.dom);
              const left = Math.max(box.left, content.left + Number.parseFloat(styles.paddingLeft));
              const height =
                Number.parseFloat(styles.getPropertyValue('--rich-control-size')) || 28;
              const top =
                currentRef.current?.node.type.name === 'horizontalRule'
                  ? box.top - (height - box.height) / 2
                  : box.top;
              return new DOMRect(left, top, Math.max(1, box.right - left), box.height);
            },
          };
        }}
        onNodeChange={({ pos }) => {
          const block = richBlockAt(editor.state.doc, pos);
          currentRef.current = block;
          setCurrent(block);
          // The library also reports targets from plugin updates. Finish that update before dispatching.
          queueMicrotask(() => {
            if (editor.isDestroyed) return;
            const hover =
              block && richBlockAt(editor.state.doc, block.pos)?.node === block.node
                ? block.pos
                : null;
            if (blockFocusKey.getState(editor.state)?.hover !== hover)
              editor.commands.setMeta(blockFocusKey, { hover });
          });
        }}
        onElementDragStart={(event) => {
          const pos = getPos();
          if (pos !== undefined && editor.isEditable) editor.commands.setMeta(blockDragKey, pos);
          else event.preventDefault();
        }}
        onElementDragEnd={() =>
          editor.chain().setMeta(blockDragKey, null).setMeta('hideDragHandle', true).run()
        }
      >
        {current && !disabled && <BlockControls editor={editor} block={current} floating />}
      </DragHandle>
      {!disabled && (
        <TouchBlockHandle editor={editor} block={active}>
          {active && <BlockControls editor={editor} block={active} />}
        </TouchBlockHandle>
      )}
    </>
  );
}

function CardView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { cards, editingCardPos } = useContext(CardContext);
  const item = props.node.attrs.item as LinkItem;
  const display = cards?.profile.links.find(
    (entry) => (item.id && entry.id === item.id) || entry.slug === item.slug.trim().toLowerCase(),
  );
  return (
    <NodeViewWrapper
      className={`rich-card${props.selected ? ' is-selected' : ''}`}
      data-editing={props.getPos() === editingCardPos || undefined}
      contentEditable={false}
    >
      {!item.visible && <span className="rich-block-hint">{t('Hidden')}</span>}
      {display && cards ? (
        <ProfileItem item={display} handle={cards.profile.handle} preview />
      ) : (
        <p className="rich-card-fallback">{item.label || item.slug}</p>
      )}
    </NodeViewWrapper>
  );
}

function OpaqueBlock(props: NodeViewProps) {
  const { t } = useTranslation();
  return (
    <NodeViewWrapper className="rich-preserved-block" contentEditable={false}>
      <span className="rich-block-hint">{t('Preserved Markdown')}</span>
      <pre>{props.node.attrs.source}</pre>
    </NodeViewWrapper>
  );
}

function GifView(props: NodeViewProps) {
  const { disabled } = useContext(CardContext);
  return <GifBlock {...props} disabled={disabled} />;
}

function ImageView(props: NodeViewProps) {
  const { disabled } = useContext(CardContext);
  return <ImageBlock {...props} disabled={disabled} />;
}

function P5View(props: NodeViewProps) {
  const { disabled, onEditP5 } = useContext(CardContext);
  const sketch = normalizeP5Embed(props.node.attrs.sketch);
  return (
    <NodeViewWrapper className="rich-p5-block" contentEditable={false}>
      {sketch && (
        <P5EmbedView
          sketch={sketch}
          onEdit={
            disabled
              ? undefined
              : (anchor) => {
                  const pos = props.getPos();
                  if (pos !== undefined) onEditP5(props.editor, pos, anchor);
                }
          }
        />
      )}
    </NodeViewWrapper>
  );
}

function BadgeView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { disabled, onEditBadge } = useContext(CardContext);
  const badge = normalizeBadgeEmbed(props.node.attrs.badge);
  return (
    <NodeViewWrapper
      as="span"
      className={`rich-badge${props.selected ? ' is-selected' : ''}`}
      contentEditable={false}
    >
      {badge && (
        <button
          type="button"
          className="rich-badge-button"
          aria-label={badge.alt ? `${t('Edit badge')}: ${badge.alt}` : t('Edit badge')}
          title={t('Edit badge')}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            const pos = props.getPos();
            if (pos !== undefined && !disabled) onEditBadge(props.editor, pos, event.currentTarget);
          }}
        >
          <BadgeEmbedView badge={badge} interactive={false} />
        </button>
      )}
    </NodeViewWrapper>
  );
}

export function RichMarkdownEditor(props: RichMarkdownEditorProps) {
  const { t } = useTranslation();
  const wya = !!props.cards;
  const parsed = useMemo(() => {
    try {
      return {
        content: markdownToRichDocument(props.source, {
          wya,
          preserveUnknown: props.preserveUnknown,
          sectionsAsHeadings: true,
        }),
        error: '',
      };
    } catch (error) {
      return { content: undefined, error: (error as Error).message };
    }
  }, [props.source, props.preserveUnknown, wya]);
  if (!parsed.content)
    return (
      <p className="page-document-error" role="alert">
        {t('This Markdown cannot be opened in Visual. You can still view or download its source.')}{' '}
        {t(parsed.error)}
      </p>
    );
  return <RichEditorSurface {...props} initialContent={parsed.content} />;
}

function RichEditorSurface({
  source,
  onChange,
  disabled = false,
  cards,
  moveTargets,
  onMoveBlock,
  moveDisabled,
  preserveUnknown = false,
  widgetOnly = false,
  onCreateWidget,
  initialContent,
}: RichMarkdownEditorProps & {
  initialContent: ReturnType<typeof markdownToRichDocument>;
}) {
  const { t } = useTranslation();
  const wya = !!cards;
  const clipboardContext = useRef(cards);
  useEffect(() => {
    clipboardContext.current = cards;
  }, [cards]);
  const paragraphPlaceholder = t('Write, or type /');
  const lastSource = useRef(source);
  const originalSource = useRef(source);
  const pendingInsertionFocus = useRef(false);
  const pendingCardFocus = useRef<(() => void) | null>(null);
  const [cardSession, setCardSession] = useState<{ pos: number | null } | null>(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ pos: number; anchor: HTMLElement } | null>(null);
  const [query, setQuery] = useState('');
  const [mediaInsertion, setMediaInsertion] = useState<{
    kind: 'gif' | 'badge' | 'p5';
    initialP5?: P5Embed;
    initialInput?: string;
    editPos?: number;
    initialBadge?: BadgeEmbed;
    target: Editor;
    document: Editor['state']['doc'];
    selection: ReturnType<Editor['state']['selection']['getBookmark']>;
    anchor: { getBoundingClientRect: () => DOMRect; contextElement: Element };
    options: { pos?: number; range?: Range };
  } | null>(null);
  const editBadge = useCallback(
    (target: Editor, pos: number, anchor: HTMLElement) => {
      if (!target.isEditable || target.isDestroyed) return;
      const node = target.state.doc.nodeAt(pos);
      const badge = node?.type.name === 'badge' && normalizeBadgeEmbed(node.attrs.badge);
      if (!badge) return;
      setMediaInsertion({
        kind: 'badge',
        editPos: pos,
        initialBadge: badge,
        target,
        document: target.state.doc,
        selection: target.state.selection.getBookmark(),
        anchor: {
          contextElement: anchor,
          getBoundingClientRect: () => anchor.getBoundingClientRect(),
        },
        options: {},
      });
    },
    [setMediaInsertion],
  );
  const editP5 = useCallback(
    (target: Editor, pos: number, anchor: HTMLElement) => {
      if (!target.isEditable || target.isDestroyed) return;
      const node = target.state.doc.nodeAt(pos);
      const sketch = node?.type.name === 'p5' && normalizeP5Embed(node.attrs.sketch);
      if (!sketch) return;
      // Editing disables block controls; keep the popup anchored to its trigger.
      const rect = anchor.getBoundingClientRect();
      setMediaInsertion({
        kind: 'p5',
        editPos: pos,
        initialP5: sketch,
        target,
        document: target.state.doc,
        selection: target.state.selection.getBookmark(),
        anchor: {
          contextElement: target.view.dom,
          getBoundingClientRect: () => rect,
        },
        options: {},
      });
    },
    [setMediaInsertion],
  );
  const openMenu = useCallback(
    (pos: number, anchor: HTMLElement) => {
      setQuery('');
      setMenu({ pos, anchor });
    },
    [setQuery, setMenu],
  );
  const beginCardSession = useCallback((target: Editor, pos: number | null) => {
    const selection = target.state.selection.getBookmark();
    const scroll = target.view.dom.closest<HTMLElement>('.rich-editor-scroll');
    const offset = { top: scroll?.scrollTop ?? 0, left: scroll?.scrollLeft ?? 0 };
    let document = target.state.doc;
    let applied = false;
    setCardSession({ pos });
    return {
      current: () => !target.isDestroyed && target.state.doc.eq(document),
      applied() {
        applied = true;
        document = target.state.doc;
      },
      restore() {
        // The parent closes its form and clears disabled in the same update. Wait
        // for that render before returning focus, or the form can capture it again.
        pendingCardFocus.current = () => {
          if (target.isDestroyed) return;
          if ((!applied || pos !== null) && target.state.doc.eq(document))
            target.view.dispatch(target.state.tr.setSelection(selection.resolve(target.state.doc)));
          target.view.focus();
          if (scroll?.isConnected) {
            scroll.scrollTop = offset.top;
            scroll.scrollLeft = offset.left;
          }
        };
        setCardSession(null);
      },
    };
  }, []);
  const editCard = useCallback(
    (target: Editor, block: RichBlock) => {
      if (!cards || target.isDestroyed || !target.isEditable) return;
      const session = beginCardSession(target, block.pos);
      cards.onEdit(
        block.node.attrs.item as LinkItem,
        (item) => {
          if (!session.current() || richBlockAt(target.state.doc, block.pos)?.node !== block.node)
            throw new Error('Could not update this card.');
          target.view.dispatch(
            closeHistory(target.state.tr).setNodeMarkup(block.pos, undefined, {
              ...block.node.attrs,
              item,
            }),
          );
          session.applied();
        },
        session.restore,
      );
    },
    [cards, beginCardSession],
  );
  const chooseBlock = useCallback(
    (target: Editor, kind: BlockKind, options: { pos?: number; range?: Range }) => {
      if (widgetOnly && !WIDGET_BLOCK_CHOICES.has(kind)) return;
      if (kind === 'gif' || kind === 'badge' || kind === 'p5') {
        const pos = options.range?.from ?? options.pos ?? target.state.selection.from;
        let rect = target.view.dom.getBoundingClientRect();
        const anchor = {
          contextElement: target.view.dom,
          getBoundingClientRect: () => {
            if (!target.isDestroyed && pos <= target.state.doc.content.size) {
              const caret = target.view.coordsAtPos(pos);
              rect = new DOMRect(
                caret.left,
                caret.top,
                Math.max(1, caret.right - caret.left),
                caret.bottom - caret.top,
              );
            }
            return rect;
          },
        };
        anchor.getBoundingClientRect();
        setMediaInsertion({
          kind,
          target,
          document: target.state.doc,
          selection: target.state.selection.getBookmark(),
          anchor,
          options,
        });
        return;
      }
      const apply = (node: Parameters<typeof insertRichBlock>[1]) => {
        const transaction = insertRichBlock(target.state, node, options);
        if (transaction) {
          pendingInsertionFocus.current = !target.isEditable;
          target.view.dispatch(transaction);
          if (target.isEditable) target.view.focus();
          return true;
        }
        return false;
      };
      if (['link', 'project', 'game', 'collection', 'discord'].includes(kind)) {
        if (!cards) return;
        const session = beginCardSession(target, null);
        cards.onInsert(
          kind as WyaBlockKind,
          (item) => {
            if (!session.current() || !apply(target.schema.nodes.wyaItem.create({ item })))
              throw new Error('Could not update this card.');
            session.applied();
          },
          session.restore,
        );
        return;
      }
      const nodes = target.schema.nodes;
      const paragraph = () => nodes.paragraph.create();
      if (kind.startsWith('heading')) apply(nodes.heading.create({ level: Number(kind.at(-1)) }));
      else if (kind === 'bulletList' || kind === 'orderedList')
        apply(nodes[kind].create(null, nodes.listItem.create(null, paragraph())));
      else if (kind === 'blockquote') apply(nodes.blockquote.create(null, paragraph()));
      else if (kind === 'codeBlock') apply(nodes.codeBlock.create());
      else if (kind === 'divider') apply(nodes.horizontalRule.create());
      else apply(paragraph());
    },
    [cards, setMediaInsertion, beginCardSession, widgetOnly],
  );
  const choose = useRef(chooseBlock);
  useEffect(() => {
    choose.current = chooseBlock;
  }, [chooseBlock]);
  const chooseSlashBlock = useCallback((target: Editor, kind: BlockKind, range: Range) => {
    choose.current(target, kind, { range });
  }, []);
  const editor = useEditor({
    extensions: [
      ...createRichDocumentExtensions({
        card: ReactNodeViewRenderer(CardView),
        opaque: ReactNodeViewRenderer(OpaqueBlock),
        gif: ReactNodeViewRenderer(GifView),
        image: ReactNodeViewRenderer(ImageView),
        badge: ReactNodeViewRenderer(BadgeView),
        p5: ReactNodeViewRenderer(P5View),
      }),
      createP5Paste((target, input) => {
        const rect = target.view.coordsAtPos(target.state.selection.from);
        setMediaInsertion({
          kind: 'p5',
          initialInput: input,
          target,
          document: target.state.doc,
          selection: target.state.selection.getBookmark(),
          anchor: {
            contextElement: target.view.dom,
            getBoundingClientRect: () =>
              new DOMRect(rect.left, rect.top, 1, rect.bottom - rect.top),
          },
          options: { range: { from: target.state.selection.from, to: target.state.selection.to } },
        });
      }),
      ...(widgetOnly ? [createWidgetDocumentConstraint(() => setError(WIDGET_EDITOR_ERROR))] : []),
      createBadgePaste(),
      createMediaPaste(),
      // Clipboard callbacks run on native copy/paste events, not during render.
      // eslint-disable-next-line react-hooks/refs
      createBlockClipboard({
        getContext: () => ({
          scope: clipboardContext.current?.scope ?? '',
          items: clipboardContext.current?.profile.links ?? [],
        }),
      }),
      createSectionMigration(),
      createBlockDragging(),
      createBlockSelection(),
      createBlockFocus(),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') return t('Heading');
          return node.type.name === 'paragraph' ? paragraphPlaceholder : '';
        },
        showOnlyCurrent: true,
        includeChildren: true,
      }),
      ...(!widgetOnly
        ? [
            createInsertionGaps({
              onAdd: openMenu,
              labels: { add: t('Add content here') },
            }),
          ]
        : []),
      // The extension only invokes this callback on user input, never during render.
      ...(!widgetOnly
        ? [
            // eslint-disable-next-line react-hooks/refs
            createSlashCommands({
              wya,
              t,
              onChoose: chooseSlashBlock,
            }),
          ]
        : []),
    ],
    content: initialContent,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'rich-document-content space-typography',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': t('Document content'),
      },
    },
    onUpdate: ({ editor, transaction }) => {
      if (transaction.getMeta(RICH_CARET_TRANSACTION)) return;
      try {
        const next = richDocumentToMarkdown(editor.getJSON(), originalSource.current, {
          wya,
          preserveUnknown,
          sectionsAsHeadings: true,
        });
        lastSource.current = next;
        setError('');
        onChange(next);
      } catch (cause) {
        setError((cause as Error).message);
      }
    },
  });
  useEffect(() => {
    if (!menu) return;
    menu.anchor.setAttribute('aria-expanded', 'true');
    return () => {
      menu.anchor.setAttribute('aria-expanded', 'false');
    };
  }, [menu]);
  useEffect(() => {
    editor?.setEditable(!disabled && !mediaInsertion, false);
    if (editor && !disabled && !mediaInsertion) {
      const restore = pendingCardFocus.current;
      pendingCardFocus.current = null;
      if (restore) {
        pendingInsertionFocus.current = false;
        restore();
      } else if (pendingInsertionFocus.current) {
        pendingInsertionFocus.current = false;
        editor.view.focus();
      }
    }
  }, [editor, disabled, mediaInsertion, cardSession]);
  useEffect(() => {
    if (editor && source !== lastSource.current) {
      lastSource.current = source;
      originalSource.current = source;
      editor.commands.setContent(
        markdownToRichDocument(source, { wya, preserveUnknown, sectionsAsHeadings: true }),
        { emitUpdate: false },
      );
    }
  }, [editor, source, wya, preserveUnknown]);
  if (!editor) return <p className="rich-editor-loading">{t('Loading…')}</p>;

  return (
    <CardContext.Provider
      value={{
        cards,
        moveTargets,
        onMoveBlock,
        moveDisabled,
        disabled: disabled || !!mediaInsertion,
        onAdd: openMenu,
        onEditCard: editCard,
        onEditBadge: editBadge,
        onEditP5: editP5,
        editingCardPos: cardSession?.pos ?? null,
        widgetOnly,
        onCreateWidget,
      }}
    >
      <div className="rich-markdown-editor" data-widget-only={widgetOnly || undefined}>
        {!widgetOnly && (
          <SelectionMenu editor={editor} disabled={disabled || !!menu || !!mediaInsertion} />
        )}
        {widgetOnly &&
          editor
            .getJSON()
            .content?.every((node) => node.type === 'paragraph' && !node.content?.length) && (
            <div className="rich-widget-choices" aria-label={t('Choose a widget block')}>
              <p>{t('Choose one block for this widget.')}</p>
              <div>
                {blockChoices(t, wya)
                  .filter((choice) => WIDGET_BLOCK_CHOICES.has(choice.id))
                  .map((choice) => (
                    <button
                      type="button"
                      key={choice.id}
                      className="button"
                      disabled={disabled || !!mediaInsertion}
                      onClick={() => chooseBlock(editor, choice.id, { pos: 0 })}
                    >
                      <choice.icon size={20} aria-hidden="true" />
                      {choice.label}
                    </button>
                  ))}
              </div>
            </div>
          )}
        {mediaInsertion?.kind === 'p5' && (
          <P5Picker
            anchor={mediaInsertion.anchor}
            initial={mediaInsertion.initialP5}
            initialInput={mediaInsertion.initialInput}
            onClose={(options) => {
              const restoreFocus = options?.restoreFocus ?? true;
              const { target, document, selection } = mediaInsertion;
              if (restoreFocus && !target.isDestroyed && target.state.doc.eq(document))
                target.view.dispatch(
                  target.state.tr.setSelection(selection.resolve(target.state.doc)),
                );
              pendingInsertionFocus.current = restoreFocus;
              setMediaInsertion(null);
            }}
            onInsert={(sketch) => {
              const { target, document, options, editPos } = mediaInsertion;
              if (!disabled && !target.isDestroyed && target.state.doc.eq(document)) {
                const transaction =
                  editPos === undefined
                    ? insertRichBlock(
                        target.state,
                        target.schema.nodes.p5.create({ sketch }),
                        options,
                      )
                    : closeHistory(target.state.tr).setNodeMarkup(editPos, undefined, { sketch });
                if (transaction) {
                  target.view.dispatch(closeHistory(transaction));
                  target.view.dispatch(closeHistory(target.state.tr));
                } else setError(t('Could not insert the sketch here. Try again.'));
              } else setError(t('The document changed. Try adding the sketch again.'));
              pendingInsertionFocus.current = true;
              setMediaInsertion(null);
            }}
          />
        )}
        {mediaInsertion?.kind === 'badge' && (
          <BadgePicker
            anchor={mediaInsertion.anchor}
            initial={mediaInsertion.initialBadge}
            onClose={(options) => {
              const restoreFocus = options?.restoreFocus ?? true;
              const { target, document, selection } = mediaInsertion;
              if (restoreFocus && !target.isDestroyed && target.state.doc.eq(document))
                target.view.dispatch(
                  target.state.tr.setSelection(selection.resolve(target.state.doc)),
                );
              pendingInsertionFocus.current = restoreFocus;
              setMediaInsertion(null);
            }}
            onInsert={(badge) => {
              const { target, document, options, editPos } = mediaInsertion;
              if (!disabled && !target.isDestroyed && target.state.doc.eq(document)) {
                const transaction =
                  editPos === undefined
                    ? insertRichBadge(target.state, badge, options)
                    : closeHistory(target.state.tr).setNodeMarkup(editPos, undefined, { badge });
                if (transaction) {
                  target.view.dispatch(transaction);
                  target.view.dispatch(closeHistory(target.state.tr));
                } else setError(t('Could not insert the badge here. Try again.'));
              } else setError(t('The document changed. Try adding the badge again.'));
              pendingInsertionFocus.current = true;
              setMediaInsertion(null);
            }}
          />
        )}
        {mediaInsertion?.kind === 'gif' && (
          <GifPicker
            anchor={mediaInsertion.anchor}
            onClose={(options) => {
              const restoreFocus = options?.restoreFocus ?? true;
              const { target, document, selection } = mediaInsertion;
              if (restoreFocus && !target.isDestroyed && target.state.doc.eq(document))
                target.view.dispatch(
                  target.state.tr.setSelection(selection.resolve(target.state.doc)),
                );
              pendingInsertionFocus.current = restoreFocus;
              setMediaInsertion(null);
            }}
            onInsert={(gif) => {
              const { target, document, options } = mediaInsertion;
              if (!disabled && !target.isDestroyed && target.state.doc.eq(document)) {
                const transaction = insertRichBlock(
                  target.state,
                  target.schema.nodes.gif.create({ gif }),
                  options,
                );
                if (transaction) target.view.dispatch(transaction);
                else setError('Could not insert the GIF here. Try again.');
              } else setError('The document changed. Try adding the GIF again.');
              pendingInsertionFocus.current = true;
              setMediaInsertion(null);
            }}
          />
        )}
        <Popover.Root
          open={!!menu && !disabled}
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
        >
          {menu && <Popover.Anchor virtualRef={{ current: menu.anchor }} />}
          <Popover.Portal>
            <Popover.Content
              className="rich-add-popup"
              align="start"
              sideOffset={6}
              collisionPadding={12}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onEscapeKeyDown={() => menu?.anchor.focus({ preventScroll: true })}
              aria-label={t('Add content')}
            >
              <BlockMenu
                items={blockChoices(t, wya, query).filter(
                  (choice) => !widgetOnly || WIDGET_BLOCK_CHOICES.has(choice.id),
                )}
                t={t}
                query={query}
                onQuery={setQuery}
                onChoose={(kind) => {
                  const pos = menu?.pos;
                  setMenu(null);
                  chooseBlock(editor, kind, { pos });
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {error && (
          <p className="page-document-error" role="alert">
            {t(error)}
          </p>
        )}
        <EditorContent editor={editor} className="rich-editor-scroll" />
        <DocumentBlockHandle editor={editor} />
      </div>
    </CardContext.Provider>
  );
}
