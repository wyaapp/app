import { ArrowUpRight } from 'lucide-react';
import type { LinkItem } from '@/lib/profile-types';
import { CollectionWidget } from './collection-widget';
import { InterestTile } from './interest-tile';
import { ProjectCard } from './project-card';
import { LinkIcon } from './link-icon';
import { ProfileTileMedia } from './profile-tile-media';
import { DiscordWidget } from './discord-widget';
import { getSocialProfile } from '@/lib/social-links';

type ProfileItemProps = { item: LinkItem; handle: string; preview: boolean };

/** Both the public page and dashboard preview use the same item renderers. */
export function ProfileItem(props: ProfileItemProps) {
  switch (props.item.kind) {
    case 'discord':
      return <DiscordWidget {...props} />;
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
  const social = getSocialProfile(item.url, item.platform);
  const content = (
    <>
      <ProfileTileMedia>
        <LinkIcon platform={item.platform} icon={item.icon} />
      </ProfileTileMedia>
      <span className="profile-tile-content">
        <strong className="profile-tile-title">{item.label}</strong>
        <small>{social?.detail ?? `/${item.slug}`}</small>
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
