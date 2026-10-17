import {ArrowUpRight,Star} from 'lucide-react';
import type {LinkItem} from '@/lib/model';
import {interestDefinitions} from '@/lib/interests';
import {ItemButtons} from './item-buttons';
import {ContentCover} from './content-cover';
import {LinkIcon} from './link-icon';

export function InterestTile({item,handle,preview=false}:{item:LinkItem;handle:string;preview?:boolean}) {
  if(!item.interest)return null;
  const content=item.interest,definition=interestDefinitions[content.type];
  return <article className="interest-tile" id={`interest-${item.id ?? item.slug}`}>
    <ContentCover url={content.coverUrl} className="interest-cover" fallback={<span className="interest-cover interest-cover-fallback" aria-hidden="true"><LinkIcon platform="website" icon={definition.icon}/></span>}/>
    <div className="interest-content">
      <span className="interest-type">{definition.label}</span>
      <h3>{item.url&&!preview&&!content.buttons?.length?<a href={`/${handle}/${item.slug}`} target="_blank" rel="noopener noreferrer">{item.label}<ArrowUpRight size={15}/></a>:item.label}</h3>
      {(content.status||content.favorite)&&<div className="interest-badges">{content.status&&<span>{definition.statuses[content.status]}</span>}{content.favorite&&<span className="interest-favorite"><Star size={12} aria-hidden="true"/>Favorite</span>}</div>}
      {content.note&&<p>{content.note}</p>}
      {Boolean(content.buttons?.length)&&<ItemButtons buttons={content.buttons!} handle={handle} slug={item.slug} preview={preview}/>}
    </div>
  </article>;
}
