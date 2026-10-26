'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/ssr/PaperPlaneTilt';
import { feedbackRetryClock, feedbackRetrySeconds } from '@/lib/feedback-retry';
import { useTranslation } from './language-provider';

// Keep the draft above the dialog so closing and reopening it does not lose text.
// The desktop app uses the same submission state and endpoint.
export function useFeedbackForm() {
  const request = useRef<AbortController | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [retrySeconds, setRetrySeconds] = useState(0);

  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => {
      const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRetrySeconds(seconds);
      if (!seconds) {
        setRetryAt(0);
        setError('');
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  function reset() {
    if (request.current) return;
    setSent(false);
    if (retryAt <= Date.now()) setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current || retryAt > Date.now()) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const body: unknown = await response.json().catch(() => null);
      const result = (body && typeof body === 'object' ? body : {}) as {
        error?: string;
        sent?: boolean;
        retryAfter?: unknown;
      };
      if (response.status === 429 && request.current === controller) {
        const seconds = feedbackRetrySeconds(
          result.retryAfter,
          response.headers.get('Retry-After'),
        );
        setRetryAt(Date.now() + seconds * 1000);
        setRetrySeconds(seconds);
      }
      if (!response.ok || result.sent !== true)
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : response.status === 429
              ? 'Too many requests. Please try again later.'
              : 'Could not send feedback.',
        );
      if (request.current === controller) {
        setSent(true);
        setMessage('');
      }
    } catch (cause) {
      if (request.current === controller) {
        setError(
          controller.signal.aborted
            ? 'Could not confirm delivery. Please try again later.'
            : cause instanceof Error
              ? cause.message
              : 'Could not send feedback. Try again.',
        );
      }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return { message, setMessage, busy, sent, error, retrySeconds, reset, submit };
}

export function FeedbackForm({
  feedback,
  onDone,
}: {
  feedback: ReturnType<typeof useFeedbackForm>;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { message, setMessage, busy, sent, error, retrySeconds, reset, submit } = feedback;

  if (sent)
    return (
      <div className="feedback-result" role="status">
        <CheckIcon weight="regular" size={24} aria-hidden="true" />
        <p>{t('Thanks! Your feedback has been sent.')}</p>
        <button type="button" className="button button-small" onClick={onDone ?? reset}>
          {t(onDone ? 'Done' : 'Send another message')}
        </button>
      </div>
    );

  return (
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
        aria-describedby={`${id}-notice ${id}-count${error ? ` ${id}-error` : ''}${retrySeconds ? ` ${id}-retry` : ''}`}
      />
      <p id={`${id}-notice`} className="subtle">
        {t('Sent to our Discord feedback channel. Your email is not included.')}
      </p>
      {error && (
        <p id={`${id}-error`} role="alert">
          {t(error)}
        </p>
      )}
      {retrySeconds > 0 && (
        <p id={`${id}-retry`} className="subtle" role="timer" aria-live="off">
          {t('Try again in {time}. Your message is still here.', {
            time: feedbackRetryClock(retrySeconds),
          })}
        </p>
      )}
      <div className="feedback-actions">
        <span id={`${id}-count`} className="subtle">
          {message.length} / 1,800
        </span>
        <button
          type="submit"
          className="button button-small"
          disabled={busy || retrySeconds > 0 || message.trim().length < 10}
        >
          {busy ? t('Sending...') : t('Send feedback')}{' '}
          <PaperPlaneTiltIcon weight="regular" aria-hidden="true" size={16} />
        </button>
      </div>
    </form>
  );
}
