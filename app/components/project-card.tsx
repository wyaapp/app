import {ArrowUpRight} from 'lucide-react';
import type {LinkItem} from '@/lib/model';
import {ProjectCover} from './project-cover';
export function ProjectCard({item,handle,preview}:{item:LinkItem;handle:string;preview:boolean}) {
  if(!item.project) return null;
  return <article className="project-tile" id={`project-${item.id ?? item.slug}`}>
    {item.project.coverUrl&&<ProjectCover key={item.project.coverUrl} url={item.project.coverUrl}/>}
    <div className="project-tile-content"><h3>{item.label}</h3><p>{item.project.description}</p>
      <div className="project-actions">{item.project.buttons.map((button,index)=>preview?
        <span className="project-action" key={index}>{button.label}<ArrowUpRight size={15}/></span>:
        <a className="project-action" key={index} href={index===0?`/${handle}/${item.slug}`:button.url} target="_blank" rel="noopener noreferrer">{button.label}<ArrowUpRight size={15}/></a>
      )}</div>
    </div>
  </article>;
}
