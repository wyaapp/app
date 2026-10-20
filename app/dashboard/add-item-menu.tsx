'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useRef, type Ref } from 'react';
import { LinkIcon } from '../components/link-icon';
import { DropdownMenu } from 'radix-ui';
import {
  ClipboardPaste,
  ChevronDown,
  Rocket,
  Gamepad2,
  LayoutGrid,
  Link2,
  List,
  Plus,
} from 'lucide-react';

export function AddItemMenu({
  buttonRef,
  busy,
  contentDisabled,
  sectionDisabled,
  onAdd,
  onSection,
  onPaste,
}: {
  buttonRef: Ref<HTMLButtonElement>;
  busy: boolean;
  contentDisabled: boolean;
  sectionDisabled: boolean;
  onAdd: (kind: 'new' | 'new-project' | 'new-interest' | 'new-collection' | 'new-discord') => void;
  onSection: () => void;
  onPaste: () => void;
}) {
  const { t } = useTranslation();
  const pasting = useRef(false);
  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (open) pasting.current = false;
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button ref={buttonRef} type="button" className="add-content-trigger" disabled={busy}>
          <span className="add-content-face">
            <Plus size={18} />
            {t('Add')}
            <ChevronDown size={15} />
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="add-content-menu"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label={t('Add to your page')}
          onCloseAutoFocus={(event) => {
            if (pasting.current) event.preventDefault();
          }}
        >
          <DropdownMenu.Item disabled={contentDisabled} onSelect={() => onAdd('new')}>
            <Link2 size={18} />
            <span>
              <strong>{t('Link')}</strong>
              <small>{t('A place to find you')}</small>
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={contentDisabled} onSelect={() => onAdd('new-project')}>
            <Rocket size={18} />
            <span>
              <strong>{t('Project')}</strong>
              <small>{t('Something you made')}</small>
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={contentDisabled} onSelect={() => onAdd('new-interest')}>
            <Gamepad2 size={18} />
            <span>
              <strong>{t('Game')}</strong>
              <small>{t('Spotlight a single game')}</small>
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={contentDisabled} onSelect={() => onAdd('new-collection')}>
            <LayoutGrid size={18} />
            <span>
              <strong>{t('Game Collection')}</strong>
              <small>{t('A grid of games you like')}</small>
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item disabled={contentDisabled} onSelect={() => onAdd('new-discord')}>
            <LinkIcon platform="discord" size={18} />
            <span>
              <strong>{t('Discord server')}</strong>
              <small>{t('Bring your community along')}</small>
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item disabled={sectionDisabled} onSelect={onSection}>
            <List size={18} />
            <span>
              <strong>{t('Section')}</strong>
              <small>{t('Group items under a heading')}</small>
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            onSelect={() => {
              pasting.current = true;
              onPaste();
            }}
          >
            <ClipboardPaste size={18} />
            <span>
              <strong>{t('Paste')}</strong>
              <small>{t('A copied item or section')}</small>
            </span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
