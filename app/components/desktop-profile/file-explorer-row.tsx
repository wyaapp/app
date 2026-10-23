'use client';
import { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
import { ScissorsIcon } from '@phosphor-icons/react/dist/ssr/Scissors';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { DesktopIcon } from '@phosphor-icons/react/dist/ssr/Desktop';
import { TrashIcon } from '@phosphor-icons/react/dist/ssr/Trash';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import type { DesktopEntry } from '@/lib/desktop-entries';
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
}) {
  function actions(): ItemAction[] {
    const result: ItemAction[] = [
      {
        label: entry.kind === 'folder' ? 'Open folder' : 'Open file',
        icon: <FolderOpenIcon size={16} />,
        onSelect: onOpen,
        disabled: busy,
      },
    ];
    if (entry.capabilities.move)
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
    if (entry.capabilities.copy)
      result.push({
        label: 'Copy',
        icon: <CopyIcon size={16} />,
        onSelect: onCopy,
        disabled: busy,
      });
    if (entry.capabilities.rename)
      result.push({
        label: 'Rename',
        icon: <PencilSimpleIcon size={16} />,
        onSelect: onRename,
        disabled: busy,
        opensForm: true,
        afterClose: focusRename,
      });
    if (entry.capabilities.pin)
      result.push({
        label: onDesktop ? 'Move out of Desktop' : 'Move to Desktop',
        icon: onDesktop ? <FolderOpenIcon size={16} /> : <DesktopIcon size={16} />,
        onSelect: onTogglePin,
        disabled: busy || !entry.capabilities.pin,
      });
    if (entry.kind === 'folder' && !entry.source.system)
      result.push({
        label: 'Delete empty folder',
        icon: <TrashIcon size={16} />,
        onSelect: onDelete,
        disabled: busy || !empty,
        opensForm: true,
      });
    return result;
  }

  const source = drag.source({ kind: entry.kind, id: entry.id }, entry.capabilities.move && !busy);
  const props: FileRowProps = {
    editable,
    selected,
    onSelect,
    onOpen,
    actions: actions(),
    rowProps: {
      ...(target ? drag.combine(source, target) : source),
      'data-selected': selected || undefined,
      'data-cut': cut || undefined,
      onContextMenu: onSelect,
      onFocus: onSelect,
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
