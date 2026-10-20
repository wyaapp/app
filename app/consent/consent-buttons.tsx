'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useState } from 'react';
import { authClient } from '@/lib/auth/client';
export default function ConsentButtons() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function decide(accept: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await authClient.oauth2.consent({ accept });
      if (result.error) {
        setError(result.error.message || 'Could not save your choice.');
        return;
      }
      if (result.data?.url) window.location.assign(result.data.url);
    } catch {
      setError('Could not connect. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p className="auth-error" role="alert">
          {t(error)}
        </p>
      )}
      <div className="auth-actions">
        <button className="button" disabled={busy} onClick={() => decide(false)}>
          {t('Cancel')}
        </button>
        <button className="button button-dark" disabled={busy} onClick={() => decide(true)}>
          {busy ? t('One moment…') : t('Allow access')}
        </button>
      </div>
    </>
  );
}
