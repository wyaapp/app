import { redirect } from 'next/navigation';
import { dashboardHref, isDashboardSection } from '@/lib/dashboard-routes';

export const dynamic = 'force-dynamic';

export default async function ExperimentalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ space?: string; tab?: string }>;
}) {
  const query = await searchParams;
  redirect(
    dashboardHref(
      isDashboardSection(query.tab) ? query.tab : 'links',
      query.space,
      '/experimental-dashboard',
    ),
  );
}
