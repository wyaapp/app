import type {InterestType} from './interests.ts';

// The editor consumes this shape regardless of the underlying media provider.
export type CatalogReference={provider:'igdb';id:number;slug:string};
export type CatalogItem={type:InterestType;title:string;coverUrl?:string;year?:number;platforms:string[];source:CatalogReference};
export function catalogUrl(source:CatalogReference):string {
  return `https://www.igdb.com/games/${encodeURIComponent(source.slug)}`;
}
