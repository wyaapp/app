import type {ReactNode} from 'react';
import {ContentCover} from './content-cover';

/** Keep icons and artwork in the same column across every profile item. */
export function ProfileTileMedia({url,portrait=false,children}:{url?:string;portrait?:boolean;children:ReactNode}) {
  return <span className="profile-tile-media" aria-hidden="true"><ContentCover url={url} className={`profile-tile-cover${portrait?' profile-tile-cover-portrait':''}`} fallback={children}/></span>;
}
