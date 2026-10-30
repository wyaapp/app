'use client';

import type { WidgetBlock } from '@/lib/widget-files';
import type { Profile } from '@/lib/profile-types';
import { P5EmbedView } from '../p5-embed';
import { GifEmbedView } from '../gif-embed';
import { DiscordWidget } from '../discord-widget';
import { HighlightedCode } from '../highlighted-code';

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
      return <P5EmbedView sketch={block.sketch} presentation="standalone" />;
    case 'gif':
      return <GifEmbedView gif={block.gif} presentation="standalone" />;
    case 'discord': {
      const item = profile.links.find((item) => item.slug === block.item.slug) ?? block.item;
      return (
        <DiscordWidget
          item={item}
          handle={profile.handle}
          preview={preview}
          presentation="standalone"
        />
      );
    }
    case 'code':
      return (
        <HighlightedCode
          source={block.code}
          language={block.language}
          className="widget-code"
          tabIndex={0}
        />
      );
  }
}
