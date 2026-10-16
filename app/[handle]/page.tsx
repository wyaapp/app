import { notFound, redirect } from 'next/navigation';
import { getPublicProfile } from '@/lib/service';
import { ProfileCard } from '../components/profile-card';
import { Brand } from '../components/brand';
import { chatGPTSignInPath } from '../chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function PublicProfile({params}:{params:Promise<{handle:string}>}) {
  const {handle} = await params;
  const profile = await getPublicProfile(handle);
  if(!profile) notFound();
  if(handle !== profile.handle) redirect(`/${profile.handle}`);
  return <main className={`public-page theme-${profile.theme}`}><div className="public-brand"><Brand/></div><ProfileCard profile={profile} primary/><a className="public-cta" href={chatGPTSignInPath('/dashboard')} target="_top">Your links deserve a home, too. <strong>Get your wya ↗</strong></a></main>;
}
