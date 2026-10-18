import { ArrowUpRight } from 'lucide-react';
import type { LinkItem } from '@/lib/profile-types';
import { CollectionWidget } from './collection-widget';
import { InterestTile } from './interest-tile';
import { ProjectCard } from './project-card';
import { LinkIcon } from './link-icon';
import { ProfileTileMedia } from './profile-tile-media';

type ProfileItemProps = { item: LinkItem; handle: string; preview: boolean };

/** Both the public page and dashboard preview use the same item renderers. */
export function ProfileItem(props: ProfileItemProps) {
  switch (props.item.kind) {
    case 'collection':
      return <CollectionWidget {...props} />;
    case 'interest':
      return <InterestTile {...props} />;
    case 'project':
      return <ProjectCard {...props} />;
    default:
      return <ProfileLink {...props} />;
  }
}

function ProfileLink({ item, handle, preview }: ProfileItemProps) {
  const content = (
    <>
      <ProfileTileMedia>
        <LinkIcon platform={item.platform} icon={item.icon} />
      </ProfileTileMedia>
      <span className="profile-tile-content">
        <strong className="profile-tile-title">{item.label}</strong>
        <small>/{item.slug}</small>
      </span>
      <ArrowUpRight size={18} />
    </>
  );
  if (preview) return <div className="profile-tile public-link">{content}</div>;
  const email = item.platform === 'email';
  return (
    <a
      data-analytics-item={item.id ?? `legacy:${item.slug}`}
      className="profile-tile public-link"
      href={email ? item.url : `/${handle}/${item.slug}`}
      target={email ? undefined : '_blank'}
      rel="noopener noreferrer"
    >
      {content}
    </a>
  );
}
