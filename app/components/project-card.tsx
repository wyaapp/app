import {ItemButtons} from './item-buttons';
import type {LinkItem} from '@/lib/model';
import {ProjectCover} from './project-cover';
export function ProjectCard({item,handle,preview}:{item:LinkItem;handle:string;preview:boolean}) {
  if(!item.project) return null;
  return <article className="project-tile" id={`project-${item.id ?? item.slug}`}>
    {item.project.coverUrl&&<ProjectCover key={item.project.coverUrl} url={item.project.coverUrl}/>}
    <div className="project-tile-content"><h3>{item.label}</h3><p>{item.project.description}</p>
      <ItemButtons buttons={item.project.buttons} handle={handle} slug={item.slug} preview={preview}/>
    </div>
  </article>;
}
