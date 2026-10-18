import type {LinkItem} from './model';

export function itemLabel(item:LinkItem):string {
  return item.label || (item.kind==='collection'?'Game Collection':item.slug);
}
