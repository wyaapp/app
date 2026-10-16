import { isStandalone } from '@/lib/auth/server';
import { requireChatGPTUser, chatGPTSignOutPath } from '../chatgpt-auth';
import { getAccount, getHistory } from '@/lib/service';
import Dashboard from './workspace';
export const dynamic = 'force-dynamic';
export default async function DashboardPage(){
  const user = await requireChatGPTUser('/dashboard');
  return <Dashboard initial={await getAccount(user.userId)} initialHistory={await getHistory(user.userId)} displayName={user.fullName ?? ''} signOut={chatGPTSignOutPath()} standalone={isStandalone()}/>;
}
