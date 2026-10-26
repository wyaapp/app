'use client';
import { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
import { ScissorsIcon } from '@phosphor-icons/react/dist/ssr/Scissors';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { HouseIcon } from '@phosphor-icons/react/dist/ssr/House';
import { TrashIcon } from '@phosphor-icons/react/dist/ssr/Trash';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { PushPinIcon } from '@phosphor-icons/react/dist/ssr/PushPin';
import { PushPinSlashIcon } from '@phosphor-icons/react/dist/ssr/PushPinSlash';
import type { DesktopEntry } from '@/lib/desktop-entries';
import { desktopAppId } from '@/lib/desktop-items';
import type { DesktopDrag } from './use-desktop-drag';
import type { ItemAction, FileRowProps } from './file-item-menu';
import { FileRow } from './file-row';
import { FolderRow } from './folder-row';
import { PageFileRow } from './page-file-row';
export function FileExplorerRow({
  entry,
  editable,
  selected,
  cut,
  busy,
  empty,
  onDesktop,
  drag,
  target,
  onSelect,
  onOpen,
  onCut,
  onCopy,
  onMove,
  onRename,
  onDelete,
  onTogglePin,
  focusRename,
  pinnedTaskbarIds = [],
  onToggleTaskbarPin,
}: {
  entry: DesktopEntry;
  editable: boolean;
  selected: boolean;
  cut: boolean;
  busy: boolean;
  empty: boolean;
  onDesktop: boolean;
  drag: DesktopDrag;
  target?: ReturnType<DesktopDrag['target']>;
  onSelect: () => void;
  onOpen: () => void;
  onCut: () => void;
  onCopy: () => void;
  onMove: () => void;
  onRename: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  focusRename: () => void;
  pinnedTaskbarIds?: readonly string[];
  onToggleTaskbarPin?: (id: string) => void;
}) {
  const appId = desktopAppId({ kind: entry.kind, id: entry.id });
  const pinned = pinnedTaskbarIds.includes(appId);
  function actions(): ItemAction[] {
    const result: ItemAction[] = [
      {
        label: entry.kind === 'folder' ? 'Open folder' : 'Open file',
        icon: <FolderOpenIcon size={16} />,
        onSelect: onOpen,
        disabled: busy,
      },
    ];
    if (onToggleTaskbarPin)
      result.push({
        label: pinned ? 'Unpin from taskbar' : 'Pin to taskbar',
        icon: pinned ? <PushPinSlashIcon size={16} /> : <PushPinIcon size={16} />,
        onSelect: () => onToggleTaskbarPin(appId),
      });
    if (editable && entry.capabilities.move)
      result.push(
        {
          label: 'Cut',
          icon: <ScissorsIcon size={16} />,
          onSelect: onCut,
          disabled: busy,
        },
        {
          label: 'Move to folder',
          icon: <FolderOpenIcon size={16} />,
          onSelect: onMove,
          disabled: busy,
          opensForm: true,
        },
      );
    if (editable && entry.capabilities.copy)
      result.push({
        label: 'Copy',
        icon: <CopyIcon size={16} />,
        onSelect: onCopy,
        disabled: busy,
      });
    if (editable && entry.capabilities.rename)
      result.push({
        label: 'Rename',
        icon: <PencilSimpleIcon size={16} />,
        onSelect: onRename,
        disabled: busy,
        opensForm: true,
        afterClose: focusRename,
      });
    if (editable && entry.capabilities.pin)
      result.push({
        label: onDesktop ? 'Move out of Home' : 'Move to Home',
        icon: onDesktop ? <FolderOpenIcon size={16} /> : <HouseIcon weight="duotone" size={16} />,
        onSelect: onTogglePin,
        disabled: busy || !entry.capabilities.pin,
      });
    if (editable && entry.kind === 'folder' && !entry.source.system)
      result.push({
        label: 'Delete empty folder',
        icon: <TrashIcon size={16} />,
        onSelect: onDelete,
        disabled: busy || !empty,
        opensForm: true,
      });
    return result;
  }

  const source = drag.source(
    { kind: entry.kind, id: entry.id },
    editable && entry.capabilities.move && !busy,
  );
  const props: FileRowProps = {
    editable,
    menuEnabled: editable || Boolean(onToggleTaskbarPin),
    selected,
    onSelect,
    onOpen,
    actions: actions(),
    rowProps: {
      ...(target ? drag.combine(source, target) : source),
      'data-selected': selected || undefined,
      'data-cut': cut || undefined,
      onContextMenu: onSelect,
      onFocus: (event) => {
        if (event.currentTarget.contains(event.target)) onSelect();
      },
      onClick: (event) => {
        if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
        onSelect();
        if (event.target === event.currentTarget)
          event.currentTarget
            .querySelector<HTMLButtonElement>('.file-open')
            ?.focus({ preventScroll: true });
      },
    } as FileRowProps['rowProps'],
  };
  return entry.kind === 'folder' ? (
    <FolderRow folder={entry.source} {...props} />
  ) : entry.kind === 'page' ? (
    <PageFileRow page={entry.source} {...props} />
  ) : (
    <FileRow file={entry.source} {...props} />
  );
}
