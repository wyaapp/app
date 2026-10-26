export type ExplorerSort = 'name-asc' | 'name-desc' | 'type';
type ExplorerItem = { name: string; kind: 'folder' | 'file' | 'page' | 'app' };

const searchText = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** Search the current directory and retain folders first in every sort order. */
export function explorerView<T extends ExplorerItem>(
  items: readonly T[],
  query: string,
  sort: ExplorerSort,
  locale: string,
): T[] {
  const search = searchText(query.trim());
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const type = (item: ExplorerItem) =>
    item.kind === 'file' ? (item.name.split('.').at(-1) ?? '') : item.kind;
  return items
    .filter((item) => searchText(item.name).includes(search))
    .sort(
      (a, b) =>
        Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
        (sort === 'type' ? collator.compare(type(a), type(b)) : 0) ||
        collator.compare(a.name, b.name) * (sort === 'name-desc' ? -1 : 1),
    );
}
