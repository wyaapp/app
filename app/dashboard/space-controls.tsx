'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
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
  const { t } = useTranslation();
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
      {t('Your username')}
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
          placeholder={t('yourname')}
          maxLength={39}
          required
          autoComplete="off"
          aria-describedby="handle-feedback"
        />
      </div>
      <small id="handle-feedback" className={available ? 'handle-available' : ''} role="status">
        {t(feedback || 'Checking availability…')}
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
  const { t } = useTranslation();
  const [candidate, setCandidate] = useState({ handle: '', valid: false });
  const onCandidate = useCallback(
    (handle: string, valid: boolean) => setCandidate({ handle, valid }),
    [],
  );
  return (
    <main className="onboarding">
      <div className="eyebrow">
        {count ? t('ROOM FOR ANOTHER SIDE OF YOU') : t('MAKE YOURSELF AT HOME')}
      </div>
      <h1>
        {count ? (
          'A new space.'
        ) : (
          <>
            {t('So, where')}
            <br />
            {t('you at?')}
          </>
        )}
      </h1>
      <p>
        {count
          ? `${count} of 5 spaces in use. Give this one its own name, links, and look.`
          : t('Start with a name. Bring the rest of your world along.')}
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
          {t('Display name')}
          <input
            name="name"
            defaultValue={count ? '' : displayName}
            placeholder={t('What should we call this space?')}
            maxLength={80}
            required
          />
        </label>
        <BioEditor disabled={busy} />
        <button className="button button-dark" disabled={busy || !candidate.valid}>
          {busy ? t('Making room…') : t('Create space')}
          <ArrowUpRightIcon weight="regular" aria-hidden="true" size={18} />
        </button>
        {onCancel && (
          <button type="button" className="button button-light" onClick={onCancel} disabled={busy}>
            {t('Back to your space')}
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
  const { t } = useTranslation();
  const [candidate, setCandidate] = useState({ handle: profile.handle, valid: false });
  const [review, setReview] = useState(false);
  const onCandidate = useCallback((handle: string, valid: boolean) => {
    setCandidate({ handle, valid });
    setReview(false);
  }, []);
  return (
    <section className="editor-panel rename-panel">
      <div className="panel-heading">
        <h2>{t('Your address')}</h2>
      </div>
      <p>
        {t(
          "Change this space's username. Only your immediately previous username redirects here, until someone claims it or you rename again. Old usernames are available immediately.",
        )}
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
          {t('Review username change')}
        </button>
      </form>
      {review && (
        <div className="confirmation" role="alert">
          <p>
            {t('Change') + ' '}
            <strong>@{profile.handle}</strong> {' ' + t('to') + ' '}
            <strong>@{candidate.handle}</strong>
            {t(
              '? Your current username becomes available immediately. It redirects here until someone claims it or you rename again. Any earlier redirect stops working.',
            )}
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
              {t('Change username') + ' '}
              <CheckIcon weight="regular" aria-hidden="true" size={16} />
            </button>
            <button
              className="button button-light"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}
      {profile.aliases.length > 0 && (
        <div className="space-aliases">
          <strong>{t('Previous address')}</strong>
          <p>{t('Redirecting here for now. Anyone can claim this username:')}</p>
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
