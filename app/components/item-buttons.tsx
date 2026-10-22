'use client';
import { ArrowUpRight } from 'lucide-react';
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
            <ArrowUpRight size={15} />
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
            <ArrowUpRight size={15} />
          </a>
        ),
      )}
    </div>
  );
}
