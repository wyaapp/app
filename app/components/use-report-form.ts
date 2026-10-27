'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { reportRetrySeconds } from '@/lib/report-retry';
import type { ReportTopic } from '@/lib/report-schema';
import { useTranslation } from './language-provider';

// The dashboard and footer Feedback forms share submission and cooldown behavior.
// Keep this hook above a dialog so closing it does not discard the draft.
export function useReportForm({
  endpoint,
  spaceId,
  topic,
}: {
  endpoint: '/api/feedback';
  spaceId?: string;
  topic?: ReportTopic;
}) {
  const { locale } = useTranslation();
  const request = useRef<AbortController | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
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
    setReference(null);
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
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          locale,
          ...(spaceId ? { spaceId } : {}),
          ...(topic ? { topic } : {}),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      const result = (body && typeof body === 'object' ? body : {}) as {
        error?: string;
        sent?: boolean;
        retryAfter?: unknown;
        reference?: unknown;
      };
      if (response.status === 429 && request.current === controller) {
        const seconds = reportRetrySeconds(result.retryAfter, response.headers.get('Retry-After'));
        setRetryAt(Date.now() + seconds * 1000);
        setRetrySeconds(seconds);
      }
      if (!response.ok || result.sent !== true)
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : response.status === 429
              ? 'Too many requests. Please try again later.'
              : 'Could not send your message. Please try again later.',
        );
      if (request.current === controller) {
        setReference(
          typeof result.reference === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(result.reference)
            ? result.reference
            : null,
        );
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
              : 'Could not send your message. Please try again later.',
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

  return { message, setMessage, busy, sent, reference, error, retrySeconds, reset, submit };
}
