'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useId, useRef, useState, type FormEvent } from 'react';
import { Dialog } from 'radix-ui';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/ssr/PaperPlaneTilt';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';

export function FeedbackDialog() {
  const { t } = useTranslation();
  const id = useId();
  const sending = useRef(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const result = (await response.json()) as { error?: string; sent?: boolean };
      if (!response.ok || result.sent !== true)
        throw new Error(
          typeof result.error === 'string' ? result.error : 'Could not send feedback.',
        );
      setSent(true);
      setMessage('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not send feedback. Try again.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (open && !sending.current) {
          setSent(false);
          setError('');
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button type="button" className="text-link">
          {t('Feedback')}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="icon-dialog-overlay" />
        <Dialog.Content className="icon-dialog feedback-dialog">
          <div className="icon-dialog-heading">
            <Dialog.Title>{t('What could be better?')}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label={t('Close feedback')}>
                <XIcon weight="regular" aria-hidden="true" size={22} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="icon-dialog-description">
            {t('Found a bug or have an idea? Tell us.')}
          </Dialog.Description>
          {sent ? (
            <div className="feedback-result" role="status">
              <CheckIcon weight="regular" size={24} aria-hidden="true" />
              <p>{t('Thanks! Your feedback has been sent.')}</p>
              <Dialog.Close asChild>
                <button type="button" className="button button-small">
                  {t('Done')}
                </button>
              </Dialog.Close>
            </div>
          ) : (
            <form className="feedback-form" onSubmit={submit} aria-busy={busy}>
              <label htmlFor={id}>{t('Your feedback')}</label>
              <textarea
                id={id}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={t("I'd love to be able to...")}
                rows={6}
                minLength={10}
                maxLength={1800}
                required
                disabled={busy}
                aria-describedby={`${id}-notice`}
              />
              <p id={`${id}-notice`} className="subtle">
                {t('Sent to our Discord feedback channel. Your email is not included.')}
              </p>
              {error && <p role="alert">{t(error)}</p>}
              <div className="feedback-actions">
                <span className="subtle">{message.length} / 1,800</span>
                <button
                  type="submit"
                  className="button button-small"
                  disabled={busy || message.trim().length < 10}
                >
                  {busy ? t('Sending...') : t('Send feedback')}{' '}
                  <PaperPlaneTiltIcon weight="regular" aria-hidden="true" size={16} />
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
