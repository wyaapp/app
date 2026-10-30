'use client';

import { Children, isValidElement, useMemo, type CSSProperties, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkDirective from 'remark-directive';
import { remarkStrikethrough } from '@/lib/remark-strikethrough';
import { remarkFonts } from '@/lib/remark-fonts';
import type { Paragraph, Root, RootContent } from 'mdast';
import { pageDirectiveItem, parsePageSource, restoreMarkdownText } from '@/lib/page-documents';
import { flattenMarkdownSections } from '@/lib/markdown-sections';
import type { Profile } from '@/lib/profile-types';
import { fileLinkUrl } from '@/lib/space-files';
import { documentAppearanceStyle, type DocumentAppearance } from '@/lib/document-appearance';
import { ProfileItem } from './profile-item';
import { useTranslation } from './language-provider';
import { GifEmbedView, gifFromMarker, remarkGifEmbeds } from './gif-embed';
import { ImageEmbedView, imageFromMarker, remarkImageEmbeds } from './image-embed';
import { normalizeImageEmbed } from '@/lib/image';
import { P5EmbedView } from './p5-embed';
import { p5FromMarker, remarkP5Embeds } from '@/lib/remark-p5';
import { BadgeEmbedView } from './badge-embed';
import { badgeFromMarker, remarkBadgeEmbeds } from '@/lib/remark-badges';
import { HighlightedCode } from './highlighted-code';

function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const nodes = Children.toArray(children);
  const code = nodes[0];
  if (
    nodes.length !== 1 ||
    !isValidElement<{ className?: string; children?: ReactNode }>(code) ||
    code.type !== 'code' ||
    typeof code.props.children !== 'string'
  ) {
    return <pre className="page-markdown-code">{children}</pre>;
  }
  const language = /(?:^|\s)language-([^\s]+)/.exec(code.props.className ?? '')?.[1];
  return (
    <HighlightedCode
      source={code.props.children}
      language={language}
      className="page-markdown-code"
      codeClassName={code.props.className}
    />
  );
}

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
      return node;
    }
    tree.children = tree.children.map(replaceCard);
  };
}

export function PageDocument({
  source,
  profile,
  preview = false,
  appearance,
  preserveUnknown = false,
}: {
  source: string;
  profile: Profile;
  preview?: boolean;
  appearance?: DocumentAppearance;
  preserveUnknown?: boolean;
}) {
  const { t } = useTranslation();
  const parsed = useMemo(() => {
    try {
      const markdown = flattenMarkdownSections(source, { preserveUnknown });
      return {
        document: parsePageSource(markdown, { preserveUnknown }),
        source: markdown,
        error: '',
      };
    } catch (error) {
      return { document: null, error: (error as Error).message };
    }
  }, [source, preserveUnknown]);
  const surfaceProps = {
    className: 'page-document space-typography document-appearance-content',
    style: documentAppearanceStyle(appearance) as CSSProperties,
    'data-document-theme': appearance?.theme ?? 'light',
  };
  if (!parsed.document)
    return (
      <div {...surfaceProps}>
        <p className="page-document-error" role="alert">
          {t('This document could not be displayed.')}
        </p>
      </div>
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
  return parsed.source.trim() ? (
    <div {...surfaceProps}>
      <Markdown
        remarkPlugins={[
          remarkDirective,
          remarkStrikethrough,
          renderWyaDirectives,
          [remarkGifEmbeds, { preserveUnknown, wya: true }],
          remarkBadgeEmbeds,
          remarkP5Embeds,
          remarkImageEmbeds,
          remarkFonts,
        ]}
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
          pre: MarkdownCodeBlock,
          blockquote: ({ children }) => (
            <blockquote className="page-markdown-quote">{children}</blockquote>
          ),
          span: ({ node, children, ...props }) => {
            const badge = badgeFromMarker(node?.properties);
            return badge ? <BadgeEmbedView badge={badge} /> : <span {...props}>{children}</span>;
          },
          div: ({ node, children, ...props }) => {
            const sketch = p5FromMarker(node?.properties);
            if (sketch) return <P5EmbedView sketch={sketch} />;
            const gif = gifFromMarker(node?.properties);
            if (gif) return <GifEmbedView gif={gif} />;
            const image = imageFromMarker(node?.properties);
            if (image) return <ImageEmbedView image={image} />;
            const slug = node?.properties['data-wya-slug'];
            const item = typeof slug === 'string' ? items.get(slug) : undefined;
            if (typeof slug === 'string')
              return item?.visible ? (
                <ProfileItem item={item} handle={profile.handle} preview={preview} />
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
          img: ({ src, alt, title }) => {
            const image = normalizeImageEmbed({ src, alt, title });
            if (!image) return <span className="file-image-alt">{alt || t('Image')}</span>;
            // Inline Markdown images stay inline; standalone images use the block renderer above.
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="document-inline-image"
                src={image.src}
                alt={image.alt || ''}
                title={image.title}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            );
          },
        }}
      >
        {parsed.source}
      </Markdown>
    </div>
  ) : (
    <div {...surfaceProps}>
      <p className="empty-profile">{t('Good things are on their way. Check back soon.')}</p>
    </div>
  );
}
