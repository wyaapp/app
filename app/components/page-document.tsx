'use client';

import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkDirective from 'remark-directive';
import { remarkStrikethrough } from '@/lib/remark-strikethrough';
import type { Nodes, Paragraph, Root, RootContent } from 'mdast';
import { EyeSlashIcon } from '@phosphor-icons/react/dist/ssr/EyeSlash';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import {
  pageDirectiveItem,
  pageDirectiveSection,
  parsePageSource,
  restoreMarkdownText,
} from '@/lib/page-documents';
import type { LinkItem, Profile } from '@/lib/profile-types';
import { fileLinkUrl } from '@/lib/space-files';
import { ProfileItem } from './profile-item';
import { useTranslation } from './language-provider';
import { GifEmbedView, gifFromMarker, remarkGifEmbeds } from './gif-embed';

/** Custom Markdown nodes become the same safe cards used by the public profile. */
function renderWyaDirectives() {
  return (tree: Root, file: { toString(): string }) => {
    restoreMarkdownText(tree, String(file));
    function replaceCard<T extends RootContent>(node: T): T | Paragraph {
      const item = pageDirectiveItem(node);
      if (item)
        // Replacing the code node also removes its normal <pre><code> wrapper.
        // Only this marker reaches React; payloads come from validated profile data.
        return {
          type: 'paragraph',
          children: [],
          data: { hName: 'div', hProperties: { 'data-wya-slug': item.slug } },
        };
      if (node.type === 'containerDirective') node.children = node.children.map(replaceCard);
      return node;
    }
    tree.children = tree.children.map(replaceCard);
    function visit(node: Nodes) {
      const section = pageDirectiveSection(node);
      if (section) {
        node.data = {
          ...node.data,
          hName: 'section',
          hProperties: { className: ['public-link-section'] },
        };
        if ('children' in node) {
          node.children = [
            {
              type: 'heading',
              depth: 3,
              children: [{ type: 'text', value: section.title }],
              data: { hProperties: { className: ['public-section-title'] } },
            },
            ...node.children.filter(
              (child) => !(child.type === 'paragraph' && child.data?.directiveLabel),
            ),
          ];
        }
      }
      if ('children' in node) node.children.forEach(visit);
    }
    tree.children.forEach(visit);
  };
}

export function DocumentCard({
  item,
  profile,
  preview,
  onEdit,
}: {
  item: LinkItem;
  profile: Pick<Profile, 'handle'>;
  preview: boolean;
  onEdit?: (item: LinkItem) => void;
}) {
  const { t } = useTranslation();
  if (!item.visible && !onEdit) return null;
  const content = <ProfileItem item={item} handle={profile.handle} preview={preview} />;
  if (!onEdit) return content;
  return (
    <div className="desktop-editable-item">
      <div className="desktop-item-actions">
        {!item.visible && (
          <span>
            <EyeSlashIcon weight="regular" aria-hidden="true" size={13} />
            {t('Hidden')}
          </span>
        )}
        <button
          type="button"
          className="desktop-edit-button"
          aria-label={t('Edit {name}', { name: item.label || item.slug })}
          onClick={() => onEdit(item)}
        >
          <PencilSimpleIcon weight="regular" aria-hidden="true" size={14} />
          {t('Edit')}
        </button>
      </div>
      {content}
    </div>
  );
}

export function PageDocument({
  source,
  profile,
  preview = false,
  onEdit,
}: {
  source: string;
  profile: Profile;
  preview?: boolean;
  onEdit?: (item: LinkItem) => void;
}) {
  const { t } = useTranslation();
  const parsed = useMemo(() => {
    try {
      return { document: parsePageSource(source), error: '' };
    } catch (error) {
      return { document: null, error: (error as Error).message };
    }
  }, [source]);
  if (!parsed.document)
    return (
      <p className="page-document-error" role="alert">
        {t('This document could not be displayed.')} {onEdit && parsed.error}
      </p>
    );
  // Render validated profile data, never a directive's untrusted payload.
  const items = new Map(
    parsed.document.items.map(({ item }) => [
      item.slug,
      profile.links.find(
        (saved) =>
          (item.id && saved.id === item.id) || saved.slug === item.slug.trim().toLowerCase(),
      ),
    ]),
  );
  return source.trim() ? (
    <div className="page-document space-typography">
      <Markdown
        remarkPlugins={[remarkDirective, remarkStrikethrough, renderWyaDirectives, remarkGifEmbeds]}
        skipHtml
        urlTransform={fileLinkUrl}
        components={{
          h1: ({ children }) => <h1 className="page-markdown-heading">{children}</h1>,
          h2: ({ children }) => <h2 className="page-markdown-heading">{children}</h2>,
          h3: ({ children, className }) => (
            <h3 className={className || 'page-markdown-heading'}>{children}</h3>
          ),
          ul: ({ children }) => <ul className="page-markdown-list">{children}</ul>,
          ol: ({ children, start }) => (
            <ol className="page-markdown-list" start={start}>
              {children}
            </ol>
          ),
          pre: ({ children }) => <pre className="page-markdown-code">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="page-markdown-quote">{children}</blockquote>
          ),
          div: ({ node, children, ...props }) => {
            const gif = gifFromMarker(node?.properties);
            if (gif) return <GifEmbedView gif={gif} />;
            const slug = node?.properties['data-wya-slug'];
            const item = typeof slug === 'string' ? items.get(slug) : undefined;
            if (typeof slug === 'string')
              return item ? (
                <DocumentCard item={item} profile={profile} preview={preview} onEdit={onEdit} />
              ) : null;
            return <div {...props}>{children}</div>;
          },
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => <span className="file-image-alt">{alt || t('Image')}</span>,
        }}
      >
        {source}
      </Markdown>
    </div>
  ) : (
    <p className="empty-profile">{t('Good things are on their way. Check back soon.')}</p>
  );
}
