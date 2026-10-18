import {ItemButtons} from './item-buttons';
import type {LinkItem} from '@/lib/model';
import {ProfileTileMedia} from './profile-tile-media';
import {LinkIcon} from './link-icon';
export function ProjectCard({item,handle,preview}:{item:LinkItem;handle:string;preview:boolean}) {
  if(!item.project) return null;
  return <article data-analytics-item={preview?undefined:item.id??`legacy:${item.slug}`} className="profile-tile project-tile" id={`project-${item.id ?? item.slug}`}>
    <ProfileTileMedia url={item.project.coverUrl}><LinkIcon icon={item.icon ?? 'rocket'}/></ProfileTileMedia>
    <div className="profile-tile-content project-tile-content"><h3 className="profile-tile-title">{item.label}</h3><p>{item.project.description}</p>
      <ItemButtons buttons={item.project.buttons} handle={handle} slug={item.slug} preview={preview}/>
    </div>
  </article>;
}
