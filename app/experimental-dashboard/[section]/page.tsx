import { notFound, redirect } from 'next/navigation';
import { dashboardHref, isDashboardSection } from '@/lib/dashboard-routes';

export const dynamic = 'force-dynamic';

export default async function LegacyDashboardSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ space?: string }>;
}) {
  const { section } = await params;
  if (!isDashboardSection(section)) notFound();
  const query = await searchParams;
  redirect(dashboardHref(section, query.space));
}
