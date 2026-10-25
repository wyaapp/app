'use client';

import type { NodeViewProps } from '@tiptap/react';
import { closeHistory } from '@tiptap/pm/history';
import { normalizeImageEmbed, type ImageEmbed } from '@/lib/image';
import { ImageEmbedView } from '../image-embed';
import { useTranslation } from '../language-provider';
import { MediaSizeMenu, ResizableMediaBlock } from './media-block';

export function ImageSizeMenu({
  image,
  disabled,
  onChange,
}: {
  image: ImageEmbed;
  disabled: boolean;
  onChange: (size: ImageEmbed['size']) => void;
}) {
  const { t } = useTranslation();
  return (
    <MediaSizeMenu
      size={image.size}
      label={t('Image size')}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export function ImageBlock(props: NodeViewProps & { disabled: boolean }) {
  const { t } = useTranslation();
  const image = normalizeImageEmbed(props.node.attrs);
  if (!image) return null;

  function commit(size: ImageEmbed['size']) {
    if (props.disabled || !props.editor.isEditable || props.editor.isDestroyed) return;
    const pos = props.getPos();
    if (pos === undefined) return;
    const { state, view } = props.editor;
    const current = state.doc.nodeAt(pos);
    if (
      current?.type.name !== 'image' ||
      current.attrs.src !== image?.src ||
      (current.attrs.size ?? undefined) === size
    )
      return;
    view.dispatch(
      closeHistory(state.tr).setNodeMarkup(pos, undefined, {
        ...current.attrs,
        size: size ?? null,
      }),
    );
  }

  return (
    <ResizableMediaBlock
      className="rich-image"
      selected={props.selected}
      disabled={props.disabled}
      size={image.size}
      resizeLabel={t('Resize image')}
      onResize={commit}
    >
      {(size) => <ImageEmbedView image={{ ...image, size }} />}
    </ResizableMediaBlock>
  );
}
