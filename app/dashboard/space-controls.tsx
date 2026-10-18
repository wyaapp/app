'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import { normalizeHandle, type Profile } from '@/lib/model';
import { BioEditor } from './bio-editor';

function HandleField({
  initial = '',
  spaceId,
  onChange,
}: {
  initial?: string;
  spaceId?: string;
  onChange: (value: string, valid: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  const [feedback, setFeedback] = useState('');
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      if (!value.trim()) {
        setFeedback('Use letters, numbers, dots, underscores, or hyphens.');
        return;
      }
      try {
        const normalized = normalizeHandle(value);
        const response = await fetch(
          `/api/handles?handle=${encodeURIComponent(normalized)}${spaceId ? `&spaceId=${encodeURIComponent(spaceId)}` : ''}`,
          { signal: abort.signal },
        );
        const result = (await response.json()) as {
          handle: string;
          available: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || 'Could not check this username.');
        if (abort.signal.aborted) return;
        setAvailable(result.available);
        setFeedback(
          result.available
            ? 'This username is available for this space.'
            : 'This username is taken or reserved.',
        );
        onChange(result.handle, result.available);
      } catch (error) {
        if (abort.signal.aborted) return;
        setAvailable(false);
        setFeedback(error instanceof Error ? error.message : 'Could not check this username.');
        onChange(value, false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [value, spaceId, onChange]);
  return (
    <label>
      Your username
      <div className="input-prefix">
        <span>wya.im/</span>
        <input
          name="handle"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setAvailable(false);
            setFeedback('Checking availability…');
            onChange(e.target.value, false);
          }}
          placeholder="yourname"
          maxLength={39}
          required
          autoComplete="off"
          aria-describedby="handle-feedback"
        />
      </div>
      <small id="handle-feedback" className={available ? 'handle-available' : ''} role="status">
        {feedback || 'Checking availability…'}
      </small>
    </label>
  );
}
type Save = (data: Record<string, unknown>) => Promise<boolean>;
export function CreateSpace({
  busy,
  onSave,
  onCancel,
  displayName,
  count,
}: {
  busy: boolean;
  onSave: Save;
  onCancel?: () => void;
  displayName: string;
  count: number;
}) {
  const [candidate, setCandidate] = useState({ handle: '', valid: false });
  const onCandidate = useCallback(
    (handle: string, valid: boolean) => setCandidate({ handle, valid }),
    [],
  );
  return (
    <main className="onboarding">
      <div className="eyebrow">
        {count ? 'ROOM FOR ANOTHER SIDE OF YOU' : 'MAKE YOURSELF AT HOME'}
      </div>
      <h1>
        {count ? (
          'A new space.'
        ) : (
          <>
            So, where
            <br />
            you at?
          </>
        )}
      </h1>
      <p>
        {count
          ? `${count} of 5 spaces in use. Give this one its own name, links, and look.`
          : 'Start with a name. Bring the rest of your world along.'}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!candidate.valid) return;
          const f = new FormData(e.currentTarget);
          await onSave({
            action: 'create_profile',
            handle: candidate.handle,
            name: f.get('name'),
            bio: f.get('bio'),
          });
        }}
      >
        <HandleField onChange={onCandidate} />
        <label>
          Display name
          <input
            name="name"
            defaultValue={count ? '' : displayName}
            placeholder="What should we call this space?"
            maxLength={80}
            required
          />
        </label>
        <BioEditor disabled={busy} />
        <button className="button button-dark" disabled={busy || !candidate.valid}>
          {busy ? 'Making room…' : 'Create space'}
          <ArrowUpRight size={18} />
        </button>
        {onCancel && (
          <button type="button" className="button button-light" onClick={onCancel} disabled={busy}>
            Back to your space
          </button>
        )}
      </form>
    </main>
  );
}
export function RenameSpace({
  profile,
  busy,
  onSave,
}: {
  profile: Profile;
  busy: boolean;
  onSave: Save;
}) {
  const [candidate, setCandidate] = useState({ handle: profile.handle, valid: false });
  const [review, setReview] = useState(false);
  const onCandidate = useCallback((handle: string, valid: boolean) => {
    setCandidate({ handle, valid });
    setReview(false);
  }, []);
  return (
    <section className="editor-panel rename-panel">
      <div className="panel-heading">
        <h2>Your address</h2>
      </div>
      <p>
        Change this space&apos;s username. Only your immediately previous username redirects here,
        until someone claims it or you rename again. Old usernames are available immediately.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (candidate.valid) setReview(true);
        }}
      >
        <HandleField initial={profile.handle} spaceId={profile.id} onChange={onCandidate} />
        <button
          className="button button-light"
          disabled={busy || !candidate.valid || candidate.handle === profile.handle}
        >
          Review username change
        </button>
      </form>
      {review && (
        <div className="confirmation" role="alert">
          <p>
            Change <strong>@{profile.handle}</strong> to <strong>@{candidate.handle}</strong>? Your
            current username becomes available immediately. It redirects here until someone claims
            it or you rename again. Any earlier redirect stops working.
          </p>
          <div>
            <button
              className="button button-dark"
              disabled={busy}
              onClick={async () => {
                if (await onSave({ action: 'rename_space', handle: candidate.handle }))
                  setReview(false);
              }}
            >
              Change username <Check size={16} />
            </button>
            <button
              className="button button-light"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {profile.aliases.length > 0 && (
        <div className="space-aliases">
          <strong>Previous address</strong>
          <p>Redirecting here for now. Anyone can claim this username:</p>
          <ul>
            {profile.aliases.map((handle) => (
              <li key={handle}>
                <a href={`/${handle}`} target="_blank" rel="noreferrer">
                  wya.im/{handle} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
