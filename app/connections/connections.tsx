'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useState } from 'react';
import { authClient } from '@/lib/auth/client';
export default function Connections({ initial }: { initial: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const [items, setItems] = useState(initial),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  async function disconnect(id: string) {
    setBusy(id);
    setError('');
    try {
      const result = await authClient.oauth2.deleteConsent({ id });
      if (result.error) setError('Could not disconnect. Please try again.');
      else setItems(items.filter((item) => item.id !== id));
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setBusy('');
    }
  }
  return (
    <div>
      {error && (
        <p role="alert" className="auth-error">
          {t(error)}
        </p>
      )}
      {items.length ? (
        items.map((item) => (
          <div className="connection-item" key={item.id}>
            <strong>{item.name}</strong>
            <button disabled={Boolean(busy)} className="button" onClick={() => disconnect(item.id)}>
              {busy === item.id ? t('Disconnecting…') : t('Disconnect')}
            </button>
          </div>
        ))
      ) : (
        <p>{t('No apps connected yet.')}</p>
      )}
    </div>
  );
}
