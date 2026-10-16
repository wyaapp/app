import { isStandalone } from '@/lib/auth/server';
import { requireChatGPTUser, chatGPTSignOutPath } from '../chatgpt-auth';
import { getAccount, getHistory, listSpaces } from '@/lib/service';
import Dashboard from './workspace';
export const dynamic = 'force-dynamic';
export default async function DashboardPage({searchParams}:{searchParams:Promise<{space?:string;tab?:string}>}){
  const user = await requireChatGPTUser('/dashboard');
  const spaces = await listSpaces(user.userId);
  const query=await searchParams;
  const requested=query.space;
  const profile = await getAccount(user.userId,spaces.find(s=>s.id===requested)?.id ?? spaces[0]?.id);
  return <Dashboard key={profile?.id ?? 'new'} initialTab={query.tab==='profile'?'profile':'links'} initial={profile} initialSpaces={spaces} initialHistory={profile?await getHistory(user.userId,profile.id):[]} displayName={user.fullName ?? ''} signOut={chatGPTSignOutPath()} standalone={isStandalone()}/>;
}
