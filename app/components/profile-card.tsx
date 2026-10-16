import { ArrowUpRight } from 'lucide-react';
import { LinkIcon } from './link-icon';
import { BioText } from './bio-text';
import { BrandSpark } from './brand-spark';
import { ProfileAvatar } from './profile-avatar';
import type { Profile } from '@/lib/model';
export function ProfileCard({profile,preview=false,primary=false}:{profile:Profile;preview?:boolean;primary?:boolean}) {
  const Heading = primary ? 'h1' : 'h2';
  return <div className={`profile-card theme-${profile.theme}`}>
    <div className="profile-cover"><span>wya.im/{profile.handle}</span><span aria-hidden="true"><BrandSpark/></span></div>
    <div className="profile-identity">
      <ProfileAvatar name={profile.name} url={profile.pictureUrl}/>
      <div className="profile-heading"><Heading>{profile.name}</Heading><span className="handle">@{profile.handle}</span></div>
      <p className="profile-bio"><BioText text={profile.bio || 'A little corner of the internet.'}/></p>
    </div>
    <div className="profile-content">
      <div className="profile-links">{profile.links.filter(l=>l.visible).map(link=>preview ?
        <div className="public-link" key={link.slug}><LinkIcon platform={link.platform} icon={link.icon}/><span><strong>{link.label}</strong><small>/{link.slug}</small></span><ArrowUpRight size={18}/></div> :
        <a className="public-link" href={`/${profile.handle}/${link.slug}`} key={link.slug} target="_blank" rel="noopener noreferrer"><LinkIcon platform={link.platform} icon={link.icon}/><span><strong>{link.label}</strong><small>/{link.slug}</small></span><ArrowUpRight size={18}/></a>
      )}</div>
      {!profile.links.some(l=>l.visible) && <p className="empty-profile">Good things are on their way. Check back soon.</p>}
      <div className="profile-signature">WHERE YOU AT? <strong>RIGHT HERE. ↗</strong></div>
    </div>
  </div>;
}
