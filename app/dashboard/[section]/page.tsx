import { notFound, redirect } from 'next/navigation';
import { isStandalone } from '@/lib/auth/server';
import { requireChatGPTUser, chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { dashboardHref, isDashboardSection } from '@/lib/dashboard-routes';
import { DashboardBootstrap } from '../bootstrap';

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
  if (section === 'links') redirect(dashboardHref('files', query.space));
  const user = await requireChatGPTUser(dashboardHref(section, query.space));
  return (
    <DashboardBootstrap
      section={section}
      spaceId={query.space}
      displayName={user.fullName ?? ''}
      signOut={chatGPTSignOutPath()}
      standalone={isStandalone()}
    />
  );
}
