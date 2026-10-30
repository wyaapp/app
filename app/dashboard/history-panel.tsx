'use client';
import type { Revision } from '@/lib/profile-types';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/app/components/language-provider';
import { translateHistoryReason } from '@/lib/i18n/history';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ClockCounterClockwise';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowCounterClockwise';
import type { ActiveWorkspace } from './use-workspace';

export function HistoryPanel({ workspace }: { workspace: ActiveWorkspace }) {
  const { t, locale } = useTranslation();
  const { profile, history, restoring, setRestoring, busy, save } = workspace;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const setHistory = workspace.setHistory;
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/dashboard/history?spaceId=${encodeURIComponent(profile.id)}`,
          { signal: controller.signal },
        );
        const result = (await response.json()) as { history: Revision[]; error?: string };
        if (!response.ok) throw new Error(result.error || 'Could not load history.');
        if (!controller.signal.aborted) setHistory(result.history);
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'Could not load history.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [profile.id, setHistory]);
  if (loading) return <p role="status">{t('Loading…')}</p>;
  if (error) return <p role="alert">{t(error)}</p>;
  return (
    <section className="history-panel">
      <p className="history-intro">
        {t('Version') + ' '}
        {profile.version}{' '}
        {' ' +
          t(
            "is current. Restore a snapshot from before any change below. Your current state will also be saved. Pictures aren't included in history.",
          )}
      </p>
      {history.length === 0 ? (
        <div className="empty-state">
          <ClockCounterClockwiseIcon weight="regular" aria-hidden="true" size={32} />
          <h2>{t('A fresh start.')}</h2>
          <p>{t('Your changes will appear here after your first update.')}</p>
        </div>
      ) : (
        history.map((rev) => (
          <div className="history-row" key={rev.version}>
            <div className="history-dot">
              <ArrowCounterClockwiseIcon weight="regular" aria-hidden="true" size={17} />
            </div>
            <div>
              <h3>{translateHistoryReason(rev.reason, t)}</h3>
              <p>
                {new Date(rev.createdAt).toLocaleString(locale)}{' '}
                {' ' + t('· previous version') + ' '}
                {rev.version}
              </p>
            </div>
            <button
              className="button button-small button-light"
              disabled={busy}
              onClick={() => setRestoring(rev)}
            >
              {t('Restore before')}
            </button>
          </div>
        ))
      )}
      {restoring && (
        <div className="confirmation" role="alert">
          <p>
            {t('Restore version') + ' '}
            {restoring.version}
            {t('? This replaces your current profile details and links.')}
          </p>
          <div>
            <button
              className="button button-dark"
              disabled={busy}
              onClick={async () => {
                if (await save({ action: 'restore_revision', revision: restoring.version }))
                  setRestoring(null);
              }}
            >
              {t('Restore version')}
            </button>
            <button
              className="button button-light"
              disabled={busy}
              onClick={() => setRestoring(null)}
            >
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
