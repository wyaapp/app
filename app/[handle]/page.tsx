import { notFound, redirect } from 'next/navigation';
import { getPublicProfile } from '@/lib/service';
import { ProfileCard } from '../components/profile-card';
import { Brand } from '../components/brand';
import { chatGPTSignInPath } from '../chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function PublicProfile({params,searchParams}:{params:Promise<{handle:string}>;searchParams:Promise<{tab?:string|string[]}>}) {
  const {handle} = await params;
  const query=await searchParams;
  const selectedTab=typeof query.tab==='string'?query.tab:undefined;
  const profile = await getPublicProfile(handle);
  if(!profile) notFound();
  if(handle !== profile.handle) redirect(`/${profile.handle}${selectedTab?`?tab=${encodeURIComponent(selectedTab)}`:''}`);
  return <main className={`public-page theme-${profile.theme}`}><div className="public-brand"><Brand/></div><ProfileCard profile={profile} primary selectedTab={selectedTab}/><a className="public-cta" href={chatGPTSignInPath('/dashboard')} target="_top">Your links deserve a home, too. <strong>Get your wya ↗</strong></a></main>;
}
