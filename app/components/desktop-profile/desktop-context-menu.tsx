'use client';

import { useRef, type HTMLAttributes, type ReactElement } from 'react';
import { ContextMenu, Slot } from 'radix-ui';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { DeviceMobileIcon } from '@phosphor-icons/react/dist/ssr/DeviceMobile';
import { PaletteIcon } from '@phosphor-icons/react/dist/ssr/Palette';
import { GearSixIcon } from '@phosphor-icons/react/dist/ssr/GearSix';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { ArrowsOutCardinalIcon } from '@phosphor-icons/react/dist/ssr/ArrowsOutCardinal';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { CaretRightIcon } from '@phosphor-icons/react/dist/ssr/CaretRight';
import { desktopIconModes, useDesktopPreferences } from '@/lib/desktop-preferences';
import { useTranslation } from '../language-provider';

type DesktopMenuApp = 'files' | 'mobile-layout' | 'appearance' | 'settings';

// Existing item menus, window contents, and native editing menus keep their own behavior.
const interactiveSurface = [
  '.desktop-shortcut',
  '.desktop-window',
  '[role="menu"]',
  '[role="dialog"]',
  '[role="button"]',
  '[role="textbox"]',
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[data-desktop-context-ignore]',
].join(',');

export function DesktopContextMenu({
  children,
  canEdit,
  disabled = false,
  onOpen,
  onArrange,
}: {
  children: ReactElement<HTMLAttributes<HTMLDivElement>>;
  canEdit: boolean;
  disabled?: boolean;
  onOpen: (id: DesktopMenuApp) => void;
  onArrange?: () => void;
}) {
  const { t } = useTranslation();
  const { iconMode, setIconMode, showFileExtensions, setShowFileExtensions } =
    useDesktopPreferences();
  const trigger = useRef<HTMLSpanElement>(null);
  const focusTarget = useRef<HTMLElement>(null);
  const opensWindow = useRef(false);
  const interactedOutside = useRef(false);
  const modeLabels = {
    auto: t('Automatic'),
    free: t('Free positioning'),
    grid: t('Snap to grid'),
  };

  function openAt(surface: HTMLElement, x: number, y: number) {
    focusTarget.current = surface;
    surface.focus({ preventScroll: true });
    // A separate trigger avoids intercepting native menus inside the workspace.
    trigger.current?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  }

  function openApp(id: DesktopMenuApp) {
    opensWindow.current = true;
    onOpen(id);
  }

  return (
    <ContextMenu.Root
      onOpenChange={(open) => {
        if (open) {
          opensWindow.current = false;
          interactedOutside.current = false;
        }
      }}
    >
      <Slot.Root
        tabIndex={children.props.tabIndex ?? 0}
        aria-label={children.props['aria-label'] ?? t('Home')}
        onContextMenu={(event) => {
          if (
            disabled ||
            event.defaultPrevented ||
            !(event.target instanceof Element) ||
            event.target.closest(interactiveSurface)
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          openAt(event.currentTarget, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (
            disabled ||
            event.defaultPrevented ||
            event.target !== event.currentTarget ||
            event.nativeEvent.isComposing ||
            event.repeat ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const bounds = event.currentTarget.getBoundingClientRect();
          openAt(event.currentTarget, bounds.left + 24, bounds.top + 24);
        }}
      >
        {children}
      </Slot.Root>
      <ContextMenu.Trigger ref={trigger} hidden aria-hidden="true" disabled={disabled} />
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="file-actions-menu desktop-context-menu"
          aria-label={t('Home options')}
          collisionPadding={12}
          onInteractOutside={() => {
            interactedOutside.current = true;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!opensWindow.current && !interactedOutside.current) {
              focusTarget.current?.focus({ preventScroll: true });
            }
          }}
        >
          <ContextMenu.Item onSelect={() => openApp('files')}>
            <FolderOpenIcon size={18} aria-hidden="true" />
            {t('Files')}
          </ContextMenu.Item>
          {canEdit && (
            <ContextMenu.Item onSelect={() => openApp('mobile-layout')}>
              <DeviceMobileIcon size={18} aria-hidden="true" />
              {t('Page layout')}
            </ContextMenu.Item>
          )}
          <ContextMenu.Item onSelect={() => openApp('appearance')}>
            <PaletteIcon size={18} aria-hidden="true" />
            {t('Appearance')}
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={() => openApp('settings')}>
            <GearSixIcon size={18} aria-hidden="true" />
            {t('Settings')}
          </ContextMenu.Item>
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger>
              <SquaresFourIcon size={18} aria-hidden="true" />
              {t('Home icon layout')}
              <CaretRightIcon
                className="desktop-context-menu-trailing"
                size={16}
                aria-hidden="true"
              />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent
                className="file-actions-menu desktop-context-menu"
                collisionPadding={12}
                sideOffset={4}
                aria-label={t('Home icon layout')}
              >
                <ContextMenu.RadioGroup
                  value={iconMode}
                  onValueChange={(value) => {
                    if (value === 'auto' || value === 'free' || value === 'grid')
                      setIconMode(value);
                  }}
                >
                  {desktopIconModes.map((mode) => (
                    <ContextMenu.RadioItem key={mode} value={mode}>
                      <span className="desktop-context-menu-indicator">
                        <ContextMenu.ItemIndicator>
                          <CheckIcon size={18} aria-hidden="true" />
                        </ContextMenu.ItemIndicator>
                      </span>
                      {modeLabels[mode]}
                    </ContextMenu.RadioItem>
                  ))}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          {iconMode !== 'auto' && onArrange && (
            <ContextMenu.Item onSelect={onArrange}>
              <ArrowsOutCardinalIcon size={18} aria-hidden="true" />
              {t('Arrange icons')}
            </ContextMenu.Item>
          )}
          <ContextMenu.CheckboxItem
            checked={showFileExtensions}
            onCheckedChange={(checked) => setShowFileExtensions(checked === true)}
          >
            <FileTextIcon size={18} aria-hidden="true" />
            {t('Show file extensions')}
            <ContextMenu.ItemIndicator className="desktop-context-menu-trailing">
              <CheckIcon size={18} aria-hidden="true" />
            </ContextMenu.ItemIndicator>
          </ContextMenu.CheckboxItem>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
