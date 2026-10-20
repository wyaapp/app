import { notFound } from 'next/navigation';
import { isStandalone } from '@/lib/auth/server';
import { requireChatGPTUser, chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { getAccount, getHistory, listSpaces, getOnboarding } from '@/lib/service';
import { dashboardHref, isDashboardSection } from '@/lib/dashboard-routes';
import Dashboard from '../workspace';

export const dynamic = 'force-dynamic';

export default async function DashboardSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ space?: string }>;
}) {
  const { section } = await params;
  if (!isDashboardSection(section)) notFound();
  const query = await searchParams;
  const user = await requireChatGPTUser(dashboardHref(section, query.space));
  const spaces = await listSpaces(user.userId);
  const profile = await getAccount(
    user.userId,
    spaces.find((space) => space.id === query.space)?.id ?? spaces[0]?.id,
  );
  return (
    <Dashboard
      initialTab={section}
      initialOnboarding={await getOnboarding(user.userId)}
      initial={profile}
      initialSpaces={spaces}
      initialHistory={profile ? await getHistory(user.userId, profile.id) : []}
      displayName={user.fullName ?? ''}
      signOut={chatGPTSignOutPath()}
      standalone={isStandalone()}
    />
  );
}
