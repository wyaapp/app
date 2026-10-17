import Link from 'next/link';
import {getProfileLayout} from '@/lib/profile-tabs';
import {ProjectCard} from './project-card';
import { getLayoutGroups } from '@/lib/link-layout';
import { ArrowUpRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import { profileThemeStyle } from '@/lib/profile-themes';
import { LinkIcon } from './link-icon';
import { BioText } from './bio-text';
import { BrandSpark } from './brand-spark';
import { ProfileAvatar } from './profile-avatar';
import type { Profile } from '@/lib/model';
export function ProfileCard({profile,preview=false,primary=false,selectedTab,onSelectTab}:{profile:Profile;preview?:boolean;primary?:boolean;selectedTab?:string;onSelectTab?:(id:string)=>void}) {
  const Heading = primary ? 'h1' : 'h2';
  const pageLayout=getProfileLayout(profile);
  const layout=pageLayout.tabs.find(tab=>preview?tab.id===selectedTab:tab.slug===selectedTab) ?? pageLayout.tabs.find(tab=>tab.id===pageLayout.defaultTabId)!;
  const groups=getLayoutGroups(layout).map(group=>({...group,links:group.slugs.flatMap(slug=>profile.links.find(link=>link.slug===slug&&link.visible) ?? [])})).filter(group=>group.links.length);
  return <div className={`profile-card theme-${profile.theme}`} style={profileThemeStyle(profile.theme) as CSSProperties}>
    <div className="profile-cover"><span>wya.im/{profile.handle}</span><span aria-hidden="true"><BrandSpark/></span></div>
    <div className="profile-identity">
      <ProfileAvatar name={profile.name} url={profile.pictureUrl}/>
      <div className="profile-heading"><Heading>{profile.name}</Heading><span className="handle">@{profile.handle}</span></div>
      <p className="profile-bio"><BioText text={profile.bio || 'A little corner of the internet.'}/></p>
    </div>
    <div className="profile-content">
      {pageLayout.tabs.length>1&&<nav className="profile-tabs" aria-label="Profile pages">{pageLayout.tabs.map(tab=>preview?<button key={tab.id} type="button" className={tab.id===layout.id?'active':''} aria-pressed={tab.id===layout.id} onClick={()=>onSelectTab?.(tab.id)}>{tab.title}</button>:<Link key={tab.id} href={`/${profile.handle}?tab=${encodeURIComponent(tab.slug)}`} scroll={false} className={tab.id===layout.id?'active':''} aria-current={tab.id===layout.id?'page':undefined}>{tab.title}</Link>)}</nav>}
      <div className="profile-links">{groups.map(group=><section className="public-link-section" key={group.id}>{group.id&&group.title&&<h3 className="public-section-title">{group.title}</h3>}{group.links.map(link=>link.kind==='project'?<ProjectCard key={link.id ?? link.slug} item={link} handle={profile.handle} preview={preview}/>:preview ?
        <div className="public-link" key={link.slug}><LinkIcon platform={link.platform} icon={link.icon}/><span><strong>{link.label}</strong><small>/{link.slug}</small></span><ArrowUpRight size={18}/></div> :
        <a className="public-link" href={link.platform==='email'?link.url:`/${profile.handle}/${link.slug}`} key={link.slug} target={link.platform==='email'?undefined:'_blank'} rel="noopener noreferrer"><LinkIcon platform={link.platform} icon={link.icon}/><span><strong>{link.label}</strong><small>/{link.slug}</small></span><ArrowUpRight size={18}/></a>
      )}</section>)}</div>
      {!groups.length && <p className="empty-profile">Good things are on their way. Check back soon.</p>}
      <div className="profile-signature">WHERE YOU AT? <strong>RIGHT HERE. ↗</strong></div>
    </div>
  </div>;
}
