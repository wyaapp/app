'use client';
import { useTranslation } from '@/app/components/language-provider';
import { translateHistoryReason } from '@/lib/i18n/history';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ClockCounterClockwise';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowCounterClockwise';
import type { ActiveWorkspace } from './use-workspace';

export function HistoryPanel({ workspace }: { workspace: ActiveWorkspace }) {
  const { t, locale } = useTranslation();
  const { profile, history, restoring, setRestoring, busy, save } = workspace;
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
