'use client';

import type { WidgetBlock } from '@/lib/widget-files';
import type { Profile } from '@/lib/profile-types';
import { P5EmbedView } from '../p5-embed';
import { GifEmbedView } from '../gif-embed';
import { DiscordWidget } from '../discord-widget';

/** A widget changes the presentation, while retaining the document's block renderers. */
export function WidgetView({
  block,
  profile,
  preview,
}: {
  block: WidgetBlock;
  profile: Profile;
  preview: boolean;
}) {
  switch (block.kind) {
    case 'p5':
      return <P5EmbedView sketch={block.sketch} presentation="window" />;
    case 'gif':
      return <GifEmbedView gif={block.gif} presentation="window" />;
    case 'discord': {
      const item = profile.links.find((item) => item.slug === block.item.slug) ?? block.item;
      return (
        <DiscordWidget
          item={item}
          handle={profile.handle}
          preview={preview}
          presentation="window"
        />
      );
    }
    case 'code':
      return (
        <pre className="widget-code" tabIndex={0}>
          <code className={block.language ? `language-${block.language}` : undefined}>
            {block.code}
          </code>
        </pre>
      );
  }
}
