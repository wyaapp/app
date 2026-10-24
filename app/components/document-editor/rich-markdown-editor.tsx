'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Editor, Range } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import DragHandle from '@tiptap/extension-drag-handle-react';
import type { NestedOptions } from '@tiptap/extension-drag-handle';
import { closeHistory } from '@tiptap/pm/history';
import { Popover, DropdownMenu } from 'radix-ui';
import { DotsSixVerticalIcon } from '@phosphor-icons/react/dist/ssr/DotsSixVertical';
import { BlockMenu, blockChoices, type BlockKind } from './block-menu';
import { SelectionMenu } from './selection-menu';
import { GifPicker } from './gif-picker';
import { GifBlock, GifSizeMenu } from './gif-block';
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
import { CaretRightIcon } from '@phosphor-icons/react/dist/ssr/CaretRight';
import { ArrowsDownUpIcon } from '@phosphor-icons/react/dist/ssr/ArrowsDownUp';
import { createSlashCommands } from './slash-commands';
import { createInsertionGaps } from './insertion-gaps';
import { insertRichBlock, RICH_CARET_TRANSACTION } from '@/lib/rich-document-insertion';
import {
  EditorContent,
  NodeViewContent,
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
type CardControls = {
  profile: Profile;
  onEdit: (item: LinkItem, apply: (item: LinkItem) => void) => void;
  onInsert: (kind: WyaBlockKind, apply: (item: LinkItem) => void) => void;
};
type RichMarkdownEditorProps = {
  source: string;
  onChange: (source: string) => void;
  disabled?: boolean;
  cards?: CardControls;
};
const CardContext = createContext<{
  cards?: CardControls;
  disabled: boolean;
  onAdd: (pos: number, anchor: HTMLElement) => void;
}>({ disabled: false, onAdd: () => {} });

type BlockActionProps = Pick<NodeViewProps, 'editor' | 'getPos' | 'node'> & {
  onEdit?: () => void;
  children?: ReactNode;
  floating?: boolean;
};

function BlockActions(props: BlockActionProps) {
  const { t } = useTranslation();
  const { disabled, onAdd } = useContext(CardContext);
  const [open, setOpen] = useState(false);
  const pos = props.getPos();
  const before = pos === undefined ? null : siblingRichBlockTarget(props.editor.state, pos, -1);
  const after = pos === undefined ? null : siblingRichBlockTarget(props.editor.state, pos, 1);
  function changeOpen(next: boolean) {
    setOpen(next);
    if (!props.editor.isDestroyed)
      props.editor.commands.setMeta(blockFocusKey, {
        hover: next ? (props.getPos() ?? null) : null,
      });
    if (props.floating && !props.editor.isDestroyed)
      props.editor.commands.setMeta('lockDragHandle', next);
  }
  function move(direction: -1 | 1) {
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
  return (
    <div
      className={`rich-block-actions ${props.floating ? 'rich-block-floating-actions' : 'rich-block-touch-actions'}`}
      data-block-type={props.node.type.name}
      contentEditable={false}
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
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {props.children}
            {props.node.type.name === 'paragraph' && props.node.content.size === 0 && (
              <DropdownMenu.Item
                onSelect={() => {
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
              <DropdownMenu.Item onSelect={props.onEdit}>
                <PencilSimpleIcon size={16} />
                {t('Edit card')}
              </DropdownMenu.Item>
            )}
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
            <DropdownMenu.Item
              onSelect={() => {
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
  const { cards, disabled } = useContext(CardContext);
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
        block.node.type.name === 'wyaItem' && cards
          ? () =>
              cards.onEdit(block.node.attrs.item as LinkItem, (item) =>
                apply({ ...block.node.attrs, item }),
              )
          : undefined
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
  const { cards, disabled } = useContext(CardContext);
  const item = props.node.attrs.item as LinkItem;
  const display = cards?.profile.links.find(
    (entry) => (item.id && entry.id === item.id) || entry.slug === item.slug.trim().toLowerCase(),
  );
  return (
    <NodeViewWrapper
      className={`rich-card${props.selected ? ' is-selected' : ''}`}
      contentEditable={false}
    >
      {!item.visible && <span className="rich-block-hint">{t('Hidden')}</span>}
      <button
        type="button"
        className="rich-card-edit"
        aria-label={t('Edit card')}
        title={t('Edit card')}
        disabled={disabled}
        onClick={() => cards?.onEdit(item, (next) => props.updateAttributes({ item: next }))}
      >
        <PencilSimpleIcon size={16} aria-hidden="true" />
      </button>
      {display && cards ? (
        <ProfileItem item={display} handle={cards.profile.handle} preview />
      ) : (
        <p className="rich-card-fallback">{item.label || item.slug}</p>
      )}
    </NodeViewWrapper>
  );
}

function SectionView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { disabled } = useContext(CardContext);
  return (
    <NodeViewWrapper className="rich-section">
      <div className="rich-section-heading" contentEditable={false}>
        <input
          aria-label={t('Section title')}
          placeholder={t('Section title')}
          value={props.node.attrs.title}
          disabled={disabled}
          maxLength={60}
          onChange={(event) => props.updateAttributes({ title: event.target.value })}
        />
      </div>
      <NodeViewContent className="rich-section-content" />
    </NodeViewWrapper>
  );
}

function OpaqueBlock(props: NodeViewProps) {
  const { t } = useTranslation();
  return (
    <NodeViewWrapper className="rich-preserved-block" contentEditable={false}>
      <span className="rich-block-hint">{t('Preserved Markdown · edit in Code')}</span>
      <pre>{props.node.attrs.source}</pre>
    </NodeViewWrapper>
  );
}

function GifView(props: NodeViewProps) {
  const { disabled } = useContext(CardContext);
  return <GifBlock {...props} disabled={disabled} />;
}

export function RichMarkdownEditor(props: RichMarkdownEditorProps) {
  const { t } = useTranslation();
  const wya = !!props.cards;
  const parsed = useMemo(() => {
    try {
      return { content: markdownToRichDocument(props.source, { wya }), error: '' };
    } catch (error) {
      return { content: undefined, error: (error as Error).message };
    }
  }, [props.source, wya]);
  if (!parsed.content)
    return (
      <p className="page-document-error" role="alert">
        {t('Fix the Markdown in Code to continue visual editing.')} {t(parsed.error)}
      </p>
    );
  return <RichEditorSurface {...props} initialContent={parsed.content} />;
}

function RichEditorSurface({
  source,
  onChange,
  disabled = false,
  cards,
  initialContent,
}: RichMarkdownEditorProps & {
  initialContent: ReturnType<typeof markdownToRichDocument>;
}) {
  const { t } = useTranslation();
  const wya = !!cards;
  const paragraphPlaceholder = t('Write, or type /');
  const lastSource = useRef(source);
  const originalSource = useRef(source);
  const pendingInsertionFocus = useRef(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ pos: number; anchor: HTMLElement } | null>(null);
  const [query, setQuery] = useState('');
  const [gifInsertion, setGifInsertion] = useState<{
    target: Editor;
    document: Editor['state']['doc'];
    selection: ReturnType<Editor['state']['selection']['getBookmark']>;
    anchor: { getBoundingClientRect: () => DOMRect; contextElement: Element };
    options: { pos?: number; range?: Range };
  } | null>(null);
  const openMenu = useCallback(
    (pos: number, anchor: HTMLElement) => {
      setQuery('');
      setMenu({ pos, anchor });
    },
    [setQuery, setMenu],
  );
  const chooseBlock = useCallback(
    (target: Editor, kind: BlockKind, options: { pos?: number; range?: Range }) => {
      if (kind === 'gif') {
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
        setGifInsertion({
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
        }
      };
      if (['link', 'project', 'game', 'collection', 'discord'].includes(kind)) {
        cards?.onInsert(kind as WyaBlockKind, (item) =>
          apply(target.schema.nodes.wyaItem.create({ item })),
        );
        return;
      }
      const nodes = target.schema.nodes;
      const paragraph = () => nodes.paragraph.create();
      if (kind === 'section')
        apply(
          nodes.wyaSection.create(
            { id: crypto.randomUUID(), title: t('New section') },
            paragraph(),
          ),
        );
      else if (kind.startsWith('heading'))
        apply(nodes.heading.create({ level: Number(kind.at(-1)) }));
      else if (kind === 'bulletList' || kind === 'orderedList')
        apply(nodes[kind].create(null, nodes.listItem.create(null, paragraph())));
      else if (kind === 'blockquote') apply(nodes.blockquote.create(null, paragraph()));
      else if (kind === 'codeBlock') apply(nodes.codeBlock.create());
      else if (kind === 'divider') apply(nodes.horizontalRule.create());
      else apply(paragraph());
    },
    [cards, t, setGifInsertion],
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
        section: ReactNodeViewRenderer(SectionView),
        opaque: ReactNodeViewRenderer(OpaqueBlock),
        gif: ReactNodeViewRenderer(GifView),
      }),
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
      createInsertionGaps({
        onAdd: openMenu,
        labels: { add: t('Add content here'), write: paragraphPlaceholder },
      }),
      // The extension only invokes this callback on user input, never during render.
      // eslint-disable-next-line react-hooks/refs
      createSlashCommands({
        wya,
        t,
        onChoose: chooseSlashBlock,
      }),
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
        const next = richDocumentToMarkdown(editor.getJSON(), originalSource.current, { wya });
        lastSource.current = next;
        setError('');
        onChange(next);
      } catch (cause) {
        setError((cause as Error).message);
      }
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled && !gifInsertion, false);
    if (editor && !disabled && !gifInsertion && pendingInsertionFocus.current) {
      pendingInsertionFocus.current = false;
      editor.view.focus();
    }
  }, [editor, disabled, gifInsertion]);
  useEffect(() => {
    if (editor && source !== lastSource.current) {
      lastSource.current = source;
      originalSource.current = source;
      editor.commands.setContent(markdownToRichDocument(source, { wya }), {
        emitUpdate: false,
      });
    }
  }, [editor, source, wya]);
  if (!editor) return <p className="rich-editor-loading">{t('Loading…')}</p>;

  return (
    <CardContext.Provider value={{ cards, disabled: disabled || !!gifInsertion, onAdd: openMenu }}>
      <div className="rich-markdown-editor">
        <SelectionMenu editor={editor} disabled={disabled || !!menu || !!gifInsertion} />
        {gifInsertion && (
          <GifPicker
            anchor={gifInsertion.anchor}
            onClose={(options) => {
              const restoreFocus = options?.restoreFocus ?? true;
              const { target, document, selection } = gifInsertion;
              if (restoreFocus && !target.isDestroyed && target.state.doc.eq(document))
                target.view.dispatch(
                  target.state.tr.setSelection(selection.resolve(target.state.doc)),
                );
              pendingInsertionFocus.current = restoreFocus;
              setGifInsertion(null);
            }}
            onInsert={(gif) => {
              const { target, document, options } = gifInsertion;
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
              setGifInsertion(null);
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
              onEscapeKeyDown={() => editor.view.focus()}
              aria-label={t('Add content')}
            >
              <BlockMenu
                items={blockChoices(t, wya, query)}
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
