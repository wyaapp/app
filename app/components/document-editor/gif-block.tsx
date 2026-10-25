'use client';

import type { ReactNode } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { closeHistory } from '@tiptap/pm/history';
import type { GifEmbed } from '@/lib/gif';
import { GifEmbedView } from '../gif-embed';
import { useTranslation } from '../language-provider';
import { MediaSizeMenu, ResizableMediaBlock } from './media-block';

export function GifSizeMenu({
  gif,
  disabled,
  onChange,
}: {
  gif: GifEmbed;
  disabled: boolean;
  onChange: (size: GifEmbed['size']) => void;
}) {
  const { t } = useTranslation();
  return (
    <MediaSizeMenu size={gif.size} label={t('GIF size')} disabled={disabled} onChange={onChange} />
  );
}

export function GifBlock({
  disabled,
  renderActions,
  ...props
}: NodeViewProps & { disabled: boolean; renderActions?: (items: ReactNode) => ReactNode }) {
  const { t } = useTranslation();
  const gif = props.node.attrs.gif as GifEmbed;

  function commit(size: GifEmbed['size']) {
    if (disabled || !props.editor.isEditable || props.editor.isDestroyed) return;
    const pos = props.getPos();
    if (pos === undefined) return;
    const { state, view } = props.editor;
    const current = state.doc.nodeAt(pos);
    const previous = current?.attrs.gif as GifEmbed | undefined;
    if (
      current?.type.name !== 'gif' ||
      previous?.id !== gif.id ||
      previous.provider !== gif.provider ||
      previous.size === size
    )
      return;
    const next = { ...previous };
    if (size === undefined) delete next.size;
    else next.size = size;
    view.dispatch(
      closeHistory(state.tr).setNodeMarkup(pos, undefined, { ...current.attrs, gif: next }),
    );
  }

  return (
    <ResizableMediaBlock
      className="rich-gif"
      selected={props.selected}
      disabled={disabled}
      size={gif.size}
      resizeLabel={t('Resize GIF')}
      onResize={commit}
      actions={renderActions?.(<GifSizeMenu gif={gif} disabled={disabled} onChange={commit} />)}
    >
      {(size) => <GifEmbedView gif={{ ...gif, size }} />}
    </ResizableMediaBlock>
  );
}
