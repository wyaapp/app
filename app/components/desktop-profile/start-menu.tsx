'use client';

import { useState, type ReactNode } from 'react';
import { Popover } from 'radix-ui';
import { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { BrandSpark } from '../brand-spark';
import { useTranslation } from '../language-provider';
import { desktopCategories, desktopCategoryIds, type DesktopCategory } from './app-categories';

export function DesktopStartMenu({
  apps,
  address,
  copied,
  onCopy,
  onOpen,
  children,
}: {
  apps: {
    id: string;
    title: string;
    Icon: PhosphorIcon;
    color: string;
    category: DesktopCategory;
  }[];
  address: string;
  copied: boolean;
  onCopy: () => void;
  onOpen: (id: string) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="desktop-start-button" aria-label={t('Start menu')}>
        <BrandSpark />
        <span>{t('Start')}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="desktop-start-menu"
          side="top"
          align="start"
          sideOffset={12}
          collisionPadding={12}
          aria-label={t('Start menu')}
        >
          <div className="desktop-start-heading">
            <strong>{address.replace('https://', '')}</strong>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Copy profile link')}
              onClick={onCopy}
            >
              {copied ? (
                <CheckIcon weight="regular" aria-hidden="true" size={18} />
              ) : (
                <CopyIcon weight="regular" aria-hidden="true" size={18} />
              )}
            </button>
          </div>
          <div className="desktop-launcher-sections">
            {desktopCategoryIds.map((category) => {
              const group = apps.filter((app) => app.category === category);
              if (!group.length) return null;
              return (
                <section
                  className="desktop-launcher-section"
                  key={category}
                  aria-label={t(desktopCategories[category].label)}
                >
                  <div className="desktop-launcher-label">
                    <h2>{t(desktopCategories[category].label)}</h2>
                    <p>{t(desktopCategories[category].description)}</p>
                  </div>
                  <div className="desktop-launcher-grid">
                    {group.map(({ id, title, Icon, color }) => (
                      <button
                        type="button"
                        key={id}
                        onClick={() => {
                          setOpen(false);
                          onOpen(id);
                        }}
                      >
                        <span
                          className={`desktop-launcher-icon desktop-color-${color}`}
                          aria-hidden="true"
                        >
                          <Icon weight="regular" aria-hidden="true" size={20} />
                        </span>
                        <span className="desktop-launcher-title">{title}</span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="desktop-start-footer">{children}</div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
