'use client';
import {useState} from 'react';
export function ProjectCover({url}:{url:string}) {
  const [failed,setFailed]=useState(false);
  if(failed) return null;
  // Browser-only loading: no server-side URL fetching or image proxy.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="project-cover" src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>;
}
