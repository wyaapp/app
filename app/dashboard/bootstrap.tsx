'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import type { WorkspaceProps, DashboardData } from './use-workspace';
import type { DashboardSection } from '@/lib/dashboard-routes';
import { useTranslation } from '../components/language-provider';
import { Brand } from '../components/brand';

// Fetch the private summary before loading the dashboard feature modules.
const Dashboard = lazy(() => import('./workspace'));
export type DashboardBootstrapProps = {
  section: DashboardSection;
  spaceId?: string;
};
export function DashboardBootstrap(props: DashboardBootstrapProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<WorkspaceProps | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/dashboard${props.spaceId ? `?spaceId=${encodeURIComponent(props.spaceId)}` : ''}`,
          {
            signal: controller.signal,
            cache: 'no-store',
          },
        );
        if (response.status === 401) {
          window.location.replace(
            `/sign-in?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`,
          );
          return;
        }
        if (!response.headers.get('content-type')?.includes('application/json'))
          throw new Error('Could not load this space.');
        const result = (await response.json()) as DashboardData;
        if (!response.ok) throw new Error(result.error || 'Could not load this space.');
        if (!controller.signal.aborted)
          setData({
            ...result,
            initialTab: props.section,
          });
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not load this space.');
      }
    })();
    return () => controller.abort();
  }, [props.spaceId, props.section, attempt]);
  if (data)
    return (
      <Suspense fallback={<DashboardLoading />}>
        <Dashboard {...data} />
      </Suspense>
    );
  return (
    <div className="simple-dashboard">
      <header className="dashboard-topbar">
        <Brand />
      </header>
      <main className="dashboard-content dashboard-loading" aria-busy={!error}>
        <h1>{t('Dashboard')}</h1>
        {error ? (
          <>
            <p role="alert">{t(error)}</p>
            <button
              className="button"
              onClick={() => {
                setError('');
                setAttempt((value) => value + 1);
              }}
            >
              {t('Try again')}
            </button>
          </>
        ) : (
          <p role="status">{t('Loading…')}</p>
        )}
      </main>
    </div>
  );
}
function DashboardLoading() {
  const { t } = useTranslation();
  return (
    <div className="simple-dashboard">
      <header className="dashboard-topbar">
        <Brand />
      </header>
      <main className="dashboard-content dashboard-loading" aria-busy="true">
        <p role="status">{t('Loading…')}</p>
      </main>
    </div>
  );
}
