'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Editor } from '@tiptap/core';
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
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowCounterClockwise';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowClockwise';
import { TextBIcon } from '@phosphor-icons/react/dist/ssr/TextB';
import { TextItalicIcon } from '@phosphor-icons/react/dist/ssr/TextItalic';
import { ListBulletsIcon } from '@phosphor-icons/react/dist/ssr/ListBullets';
import { ListNumbersIcon } from '@phosphor-icons/react/dist/ssr/ListNumbers';
import { QuotesIcon } from '@phosphor-icons/react/dist/ssr/Quotes';
import { CodeIcon } from '@phosphor-icons/react/dist/ssr/Code';
import { CodeBlockIcon } from '@phosphor-icons/react/dist/ssr/CodeBlock';
import { LinkIcon } from '@phosphor-icons/react/dist/ssr/Link';
import { MinusIcon } from '@phosphor-icons/react/dist/ssr/Minus';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { TrashIcon } from '@phosphor-icons/react/dist/ssr/Trash';
import { markdownToRichDocument, richDocumentToMarkdown } from '@/lib/rich-document';
import { fileLinkUrl } from '@/lib/space-files';
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
const CardContext = createContext<{ cards?: CardControls; disabled: boolean }>({ disabled: false });

function IconButton({
  label,
  children,
  active,
  onClick,
  disabled,
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function moveNode(props: NodeViewProps, direction: -1 | 1) {
  const pos = props.getPos();
  if (pos === undefined) return;
  const { state, view } = props.editor;
  const resolved = state.doc.resolve(pos);
  const sibling =
    direction === -1 ? resolved.nodeBefore : state.doc.nodeAt(pos + props.node.nodeSize);
  if (!sibling || (direction === 1 && pos + props.node.nodeSize >= resolved.end())) return;
  const target = direction === -1 ? pos - sibling.nodeSize : pos + sibling.nodeSize;
  view.dispatch(state.tr.delete(pos, pos + props.node.nodeSize).insert(target, props.node));
}

function BlockActions(props: NodeViewProps & { children?: ReactNode }) {
  const { t } = useTranslation();
  const { disabled } = useContext(CardContext);
  const pos = props.getPos();
  const resolved = pos === undefined ? undefined : props.editor.state.doc.resolve(pos);
  return (
    <div className="rich-block-actions" contentEditable={false}>
      {props.children}
      <IconButton
        label={t('Move up')}
        disabled={disabled || !resolved?.nodeBefore}
        onClick={() => moveNode(props, -1)}
      >
        <ArrowUpIcon size={16} />
      </IconButton>
      <IconButton
        label={t('Move down')}
        disabled={disabled || !resolved || pos! + props.node.nodeSize >= resolved.end()}
        onClick={() => moveNode(props, 1)}
      >
        <ArrowDownIcon size={16} />
      </IconButton>
      <IconButton label={t('Remove block')} disabled={disabled} onClick={props.deleteNode}>
        <TrashIcon size={16} />
      </IconButton>
    </div>
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
      <BlockActions {...props}>
        {!item.visible && <span className="rich-block-hint">{t('Hidden')}</span>}
        <button
          type="button"
          disabled={disabled}
          onClick={() => cards?.onEdit(item, (next) => props.updateAttributes({ item: next }))}
        >
          <PencilSimpleIcon size={16} aria-hidden="true" />
          {t('Edit card')}
        </button>
      </BlockActions>
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
        <BlockActions {...props} />
      </div>
      <NodeViewContent className="rich-section-content" />
    </NodeViewWrapper>
  );
}

function OpaqueBlock(props: NodeViewProps) {
  const { t } = useTranslation();
  return (
    <NodeViewWrapper className="rich-preserved-block" contentEditable={false}>
      <BlockActions {...props}>
        <span className="rich-block-hint">{t('Preserved Markdown · edit in Code')}</span>
      </BlockActions>
      <pre>{props.node.attrs.source}</pre>
    </NodeViewWrapper>
  );
}

/** Place Wya blocks beside prose, never inside a list or quote. */
function insertionPoint(editor: Editor, section = false) {
  const { $from } = editor.state.selection;
  if (!section) {
    for (let depth = $from.depth; depth > 0; depth--)
      if ($from.node(depth).type.name === 'wyaSection')
        return $from.depth > depth ? $from.after(depth + 1) : $from.pos;
  }
  return $from.depth ? $from.after(1) : $from.pos;
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
  const lastSource = useRef(source);
  const [error, setError] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const editor = useEditor({
    extensions: createRichDocumentExtensions({
      card: ReactNodeViewRenderer(CardView),
      section: ReactNodeViewRenderer(SectionView),
      opaque: ReactNodeViewRenderer(OpaqueBlock),
    }),
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
    onUpdate: ({ editor }) => {
      try {
        const next = richDocumentToMarkdown(editor.getJSON(), lastSource.current, { wya });
        lastSource.current = next;
        setError('');
        onChange(next);
      } catch (cause) {
        setError((cause as Error).message);
      }
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  useEffect(() => {
    if (editor && source !== lastSource.current) {
      lastSource.current = source;
      editor.commands.setContent(markdownToRichDocument(source, { wya }), {
        emitUpdate: false,
      });
    }
  }, [editor, source, wya]);
  if (!editor) return <p className="rich-editor-loading">{t('Loading…')}</p>;

  function insert(kind: string) {
    if (!editor || !cards) return;
    const pos = insertionPoint(editor, kind === 'section');
    if (kind === 'section') {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, [
          {
            type: 'wyaSection',
            attrs: { id: crypto.randomUUID(), title: t('New section') },
            content: [{ type: 'paragraph' }],
          },
          { type: 'paragraph' },
        ])
        .run();
    } else
      cards.onInsert(kind as WyaBlockKind, (item) => {
        editor
          .chain()
          .focus()
          .insertContentAt(pos, [{ type: 'wyaItem', attrs: { item } }, { type: 'paragraph' }])
          .run();
      });
  }
  const commands = [
    {
      label: 'Bold',
      icon: TextBIcon,
      active: editor.isActive('bold'),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      icon: TextItalicIcon,
      active: editor.isActive('italic'),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Bullet list',
      icon: ListBulletsIcon,
      active: editor.isActive('bulletList'),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      icon: ListNumbersIcon,
      active: editor.isActive('orderedList'),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Quote',
      icon: QuotesIcon,
      active: editor.isActive('blockquote'),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: 'Inline code',
      icon: CodeIcon,
      active: editor.isActive('code'),
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: 'Code block',
      icon: CodeBlockIcon,
      active: editor.isActive('codeBlock'),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
  ];
  return (
    <CardContext.Provider value={{ cards, disabled }}>
      <div className="rich-markdown-editor">
        <div className="rich-editor-toolbar" role="group" aria-label={t('Text formatting')}>
          <select
            aria-label={t('Text style')}
            disabled={disabled}
            value={
              editor.isActive('heading')
                ? String(editor.getAttributes('heading').level)
                : 'paragraph'
            }
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'paragraph') editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .setHeading({ level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 })
                  .run();
            }}
          >
            <option value="paragraph">{t('Paragraph')}</option>
            {[1, 2, 3, 4, 5, 6].map((level) => (
              <option key={level} value={level}>
                {t('Heading')} {level}
              </option>
            ))}
          </select>
          {commands.map(({ label, icon: Icon, active, run }) => (
            <IconButton
              key={label}
              label={t(label)}
              active={active}
              disabled={disabled}
              onClick={run}
            >
              <Icon size={18} aria-hidden="true" />
            </IconButton>
          ))}
          <IconButton
            label={t('Text link')}
            active={editor.isActive('link')}
            disabled={disabled}
            onClick={() => {
              setLinkUrl(editor.getAttributes('link').href ?? '');
              setLinkOpen(!linkOpen);
            }}
          >
            <LinkIcon size={18} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={t('Divider')}
            disabled={disabled}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <MinusIcon size={18} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={t('Undo')}
            disabled={disabled || !editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <ArrowCounterClockwiseIcon size={18} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={t('Redo')}
            disabled={disabled || !editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <ArrowClockwiseIcon size={18} aria-hidden="true" />
          </IconButton>
          {cards && (
            <select
              className="rich-insert-control"
              aria-label={t('Insert Wya content')}
              disabled={disabled}
              value=""
              onChange={(event) => insert(event.target.value)}
            >
              <option value="" disabled>
                {t('Insert Wya content')}
              </option>
              <option value="link">{t('Link card')}</option>
              <option value="project">{t('Project')}</option>
              <option value="game">{t('Game')}</option>
              <option value="collection">{t('Collection')}</option>
              <option value="discord">{t('Discord server')}</option>
              <option value="section">{t('Section')}</option>
            </select>
          )}
        </div>
        {linkOpen && (
          <form
            className="rich-link-form"
            onSubmit={(event) => {
              event.preventDefault();
              const href = fileLinkUrl(linkUrl.trim());
              if (linkUrl.trim() && !href) {
                setError(t('Enter a valid link.'));
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
              setError('');
              setLinkOpen(false);
            }}
          >
            <label>
              {t('Text link')}
              <input
                disabled={disabled}
                value={linkUrl}
                placeholder="https://"
                onChange={(event) => setLinkUrl(event.target.value)}
              />
            </label>
            <button type="submit" disabled={disabled}>
              {t('Apply')}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setLinkOpen(false);
              }}
            >
              {t('Remove link')}
            </button>
            <button type="button" onClick={() => setLinkOpen(false)}>
              {t('Cancel')}
            </button>
          </form>
        )}
        {error && (
          <p className="page-document-error" role="alert">
            {t(error)}
          </p>
        )}
        <EditorContent editor={editor} className="rich-editor-scroll" />
      </div>
    </CardContext.Provider>
  );
}
