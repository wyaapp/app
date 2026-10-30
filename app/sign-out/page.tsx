'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useState } from 'react';
import { Brand } from '../components/brand';
import { authClient } from '@/lib/auth/client';
export default function SignOut() {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="auth-shell">
      <Brand />
      <section className="auth-card">
        <h1>{t('See you soon.')}</h1>
        <p>{t('Sign out of this browser?')}</p>
        {error && <p role="alert">{t(error)}</p>}
        <button
          className="button button-dark"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await authClient.signOut();
              if (result.error) setError('Could not sign out. Please try again.');
              else {
                // A full navigation discards all cached authenticated page data.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.assign('/');
              }
            } catch {
              setError('Could not connect. Please try again.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t('Signing out…') : t('Sign out')}
        </button>
        <a href="/dashboard" className="text-link">
          {t('Back to your space')}
        </a>
      </section>
    </main>
  );
}
