'use client';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { useSpacePath } from './public-address-provider';
import type { ItemButton } from '@/lib/item-buttons';

export function ItemButtons({
  buttons,
  handle,
  slug,
  preview = false,
}: {
  buttons: ItemButton[];
  handle: string;
  slug: string;
  preview?: boolean;
}) {
  const path = useSpacePath(handle);
  return (
    <div className="project-actions">
      {buttons.map((button, index) =>
        preview ? (
          <span className="project-action" key={index}>
            {button.label}
            <ArrowUpRightIcon weight="regular" aria-hidden="true" size={15} />
          </span>
        ) : (
          <a
            className="project-action"
            key={index}
            href={index === 0 ? path(slug) : button.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {button.label}
            <ArrowUpRightIcon weight="regular" aria-hidden="true" size={15} />
          </a>
        ),
      )}
    </div>
  );
}
