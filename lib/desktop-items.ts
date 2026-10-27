import { getFileFormat } from './file-formats.ts';

export const DESKTOP_DRAG_TYPE = 'application/x-wya-desktop-item';
export type DesktopItem = { kind: 'app' | 'file' | 'folder'; id: string };

export function readDesktopDrag(value: string, spaceId: string): DesktopItem | null {
  try {
    const item = JSON.parse(value);
    if (
      item.spaceId !== spaceId ||
      !['app', 'file', 'folder'].includes(item.kind) ||
      typeof item.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id)
    )
      return null;
    return { kind: item.kind, id: item.id };
  } catch {
    return null;
  }
}
export function desktopAppId(item: DesktopItem) {
  return item.kind === 'app' ? item.id : `${item.kind}-${item.id}`;
}
export function desktopItem(id: string): DesktopItem {
  if (id.startsWith('file-')) return { kind: 'file', id: id.slice(5) };
  if (id.startsWith('folder-')) return { kind: 'folder', id: id.slice(7) };
  return { kind: 'app', id };
}

/** Presentation only: keep real names intact for opening, renaming, and tooltips. */
export function desktopShortcutLabel(id: string, name: string, showFileExtensions: boolean) {
  const { kind } = desktopItem(id);
  if (showFileExtensions || kind !== 'file') return name;
  return getFileFormat(name) && name.lastIndexOf('.') > 0
    ? name.slice(0, name.lastIndexOf('.'))
    : name;
}

export function orderedDesktopItems<T extends { id: string }>(items: T[], order: string[]) {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort(
    (a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length),
  );
}
export function moveDesktopItem(ids: string[], id: string, target: string) {
  const from = ids.indexOf(id),
    to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
