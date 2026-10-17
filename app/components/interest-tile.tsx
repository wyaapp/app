import {ArrowUpRight,Star} from 'lucide-react';
import type {LinkItem} from '@/lib/model';
import {interestDefinitions} from '@/lib/interests';
import {ItemButtons} from './item-buttons';
import {ProfileTileMedia} from './profile-tile-media';
import {LinkIcon} from './link-icon';

export function InterestTile({item,handle,preview=false}:{item:LinkItem;handle:string;preview?:boolean}) {
  if(!item.interest)return null;
  const content=item.interest,definition=interestDefinitions[content.type];
  return <article className="profile-tile interest-tile" id={`interest-${item.id ?? item.slug}`}>
    <ProfileTileMedia url={content.coverUrl} portrait><LinkIcon icon={definition.icon}/></ProfileTileMedia>
    <div className="profile-tile-content interest-content">
      <h3 className="profile-tile-title">{item.url&&!preview&&!content.buttons?.length?<a href={`/${handle}/${item.slug}`} target="_blank" rel="noopener noreferrer">{item.label}<ArrowUpRight size={15}/></a>:item.label}</h3>
      <span className="interest-type">{definition.label}</span>
      {(content.status||content.favorite)&&<div className="interest-badges">{content.status&&<span>{definition.statuses[content.status]}</span>}{content.favorite&&<span className="interest-favorite"><Star size={12} aria-hidden="true"/>Favorite</span>}</div>}
      {content.note&&<p>{content.note}</p>}
      {Boolean(content.buttons?.length)&&<ItemButtons buttons={content.buttons!} handle={handle} slug={item.slug} preview={preview}/>}
    </div>
  </article>;
}
