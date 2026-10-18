import { History, RotateCcw } from 'lucide-react';
import type { ActiveWorkspace } from './use-workspace';

export function HistoryPanel({ workspace }: { workspace: ActiveWorkspace }) {
  const { profile, history, restoring, setRestoring, busy, save } = workspace;
  return (
    <section className="history-panel">
      <p className="history-intro">
        Version {profile.version} is current. Restore a snapshot from before any change below. Your
        current state will also be saved. Pictures aren&apos;t included in history.
      </p>
      {history.length === 0 ? (
        <div className="empty-state">
          <History size={32} />
          <h2>A fresh start.</h2>
          <p>Your changes will appear here after your first update.</p>
        </div>
      ) : (
        history.map((rev) => (
          <div className="history-row" key={rev.version}>
            <div className="history-dot">
              <RotateCcw size={17} />
            </div>
            <div>
              <h3>{rev.reason}</h3>
              <p>
                {new Date(rev.createdAt).toLocaleString()} · previous version {rev.version}
              </p>
            </div>
            <button
              className="button button-small button-light"
              disabled={busy}
              onClick={() => setRestoring(rev)}
            >
              Restore before
            </button>
          </div>
        ))
      )}
      {restoring && (
        <div className="confirmation" role="alert">
          <p>
            Restore version {restoring.version}? This replaces your current profile details and
            links.
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
              Restore version
            </button>
            <button
              className="button button-light"
              disabled={busy}
              onClick={() => setRestoring(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
