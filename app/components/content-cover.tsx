'use client';
import {useState,type ReactNode} from 'react';

export function ContentCover({url,className,fallback=null}:{url?:string;className:string;fallback?:ReactNode}) {
  const [failedUrl,setFailedUrl]=useState<string>();
  if(!url||failedUrl===url)return <>{fallback}</>;
  // Loaded directly by the visitor's browser, never fetched by the Worker.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailedUrl(url)}/>;
}
