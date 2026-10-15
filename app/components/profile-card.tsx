import { ArrowUpRight, Code2, Camera, BriefcaseBusiness, Globe, MessageCircle, Link2 } from 'lucide-react';
import type { Profile, Platform } from '@/lib/model';
export function PlatformIcon({platform,size=20}:{platform:Platform;size?:number}) {
  const Icon = {github:Code2,instagram:Camera,linkedin:BriefcaseBusiness,website:Globe,discord:MessageCircle,custom:Link2}[platform];
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true"/>;
}
export function ProfileCard({profile,preview=false}:{profile:Profile;preview?:boolean}) {
  return <div className={`profile-card theme-${profile.theme}`}>
    <div className="profile-cover"><span>somewhere on the internet</span><span>✳</span></div>
    <div className="profile-content">
      <div className="avatar">{profile.name.trim().split(/\s+/).map(n=>n[0]).slice(0,2).join('').toUpperCase() || '?'}</div>
      <div className="profile-heading"><h2>{profile.name}</h2><span className="handle">@{profile.handle}</span></div>
      <p className="profile-bio">{profile.bio || 'A little corner of the internet.'}</p>
      <div className="profile-links">{profile.links.filter(l=>l.visible).map(link=>preview ?
        <div className="public-link" key={link.slug}><PlatformIcon platform={link.platform}/><span>{link.label}</span><ArrowUpRight size={18}/></div> :
        <a className="public-link" href={`/${profile.handle}/${link.slug}`} key={link.slug} target="_blank" rel="noopener noreferrer"><PlatformIcon platform={link.platform}/><span>{link.label}</span><ArrowUpRight size={18}/></a>
      )}</div>
      {!profile.links.some(l=>l.visible) && <p className="empty-profile">Good things are on their way. Check back soon.</p>}
      <div className="profile-signature">where you at? <strong>wya.im/{profile.handle}</strong></div>
    </div>
  </div>;
}
