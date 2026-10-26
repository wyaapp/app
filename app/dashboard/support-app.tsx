'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/ssr/CheckCircle';
import { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
import { CreditCardIcon } from '@phosphor-icons/react/dist/ssr/CreditCard';
import { LifebuoyIcon } from '@phosphor-icons/react/dist/ssr/Lifebuoy';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/ssr/PaperPlaneTilt';
import { QuestionIcon } from '@phosphor-icons/react/dist/ssr/Question';
import {
  CONTACT_MESSAGE_MAX,
  CONTACT_MESSAGE_MIN,
  CONTACT_TOPICS,
  type ContactTopic,
} from '@/lib/contact-schema';
import { emailLink } from '@/lib/email-links';
import { useTranslation } from '../components/language-provider';

const supportAddress = 'contact@wya.im';

export function SupportApp({
  spaceId,
  onOpenHelp,
  onOpenBilling,
}: {
  spaceId?: string;
  onOpenHelp: () => void;
  onOpenBilling: () => void;
}) {
  const { locale, t } = useTranslation();
  const id = useId();
  const [topic, setTopic] = useState<ContactTopic>('account');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const request = useRef<AbortController | null>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);

  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, message, ...(spaceId ? { spaceId } : {}), locale }),
      });
      const result = (await response.json()) as {
        sent?: boolean;
        reference?: string;
        error?: string;
      };
      if (
        !response.ok ||
        result.sent !== true ||
        typeof result.reference !== 'string' ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(result.reference)
      )
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : 'Could not send your message. Try again.',
        );
      if (request.current === controller) {
        setReference(result.reference);
        setMessage('');
      }
    } catch (cause) {
      if (request.current === controller)
        setError(
          controller.signal.aborted
            ? 'Could not confirm delivery. Please try again later.'
            : cause instanceof Error
              ? cause.message
              : 'Could not send your message. Try again.',
        );
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  function sendAnother() {
    setReference(null);
    setError('');
    requestAnimationFrame(() => messageInput.current?.focus());
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(supportAddress);
      setCopyStatus('Email address copied.');
    } catch {
      setCopyStatus('Select and copy the email address above.');
    }
  }

  return (
    <section className="editor-panel support-app" aria-labelledby={`${id}-heading`}>
      <header className="support-heading">
        <LifebuoyIcon size={24} weight="duotone" aria-hidden="true" />
        <h2 id={`${id}-heading`}>{t('Support')}</h2>
      </header>
      <p className="support-intro">
        {t('Get help with your account, subscription, or custom domain. We reply by email.')}
      </p>

      {reference ? (
        <div className="support-result" role="status">
          <CheckCircleIcon size={32} weight="duotone" aria-hidden="true" />
          <h3>{t('Your message has been sent.')}</h3>
          <p>{t('We will follow up using your account email.')}</p>
          <p className="support-reference">
            <span>{t('Reference')}</span>
            <code>{reference}</code>
          </p>
          <button type="button" className="button button-small" onClick={sendAnother}>
            {t('Send another message')}
          </button>
        </div>
      ) : (
        <form className="support-compose" onSubmit={submit} aria-busy={busy}>
          <label htmlFor={`${id}-topic`}>{t('What do you need help with?')}</label>
          <select
            id={`${id}-topic`}
            value={topic}
            onChange={(event) => setTopic(event.target.value as ContactTopic)}
            disabled={busy}
          >
            {Object.entries(CONTACT_TOPICS).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-message`}>{t('Your message')}</label>
          <textarea
            ref={messageInput}
            id={`${id}-message`}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={t('Describe the problem and what you expected to happen.')}
            minLength={CONTACT_MESSAGE_MIN}
            maxLength={CONTACT_MESSAGE_MAX}
            rows={7}
            required
            disabled={busy}
            aria-describedby={`${id}-disclosure ${id}-count${error ? ` ${id}-error` : ''}`}
          />
          <p id={`${id}-disclosure`} className="support-caption">
            {t(
              'Your name, email, account and space IDs, and plan details are sent to our support team through Discord.',
            )}
          </p>
          {error && (
            <p id={`${id}-error`} role="alert" className="support-error">
              {t(error)}
            </p>
          )}
          <div className="support-submit">
            <span id={`${id}-count`}>{message.length} / 1,800</span>
            <button
              className="button button-small"
              type="submit"
              disabled={busy || message.trim().length < CONTACT_MESSAGE_MIN}
            >
              {t(busy ? 'Sending...' : 'Send message')}
              <PaperPlaneTiltIcon size={18} aria-hidden="true" />
            </button>
          </div>
        </form>
      )}

      <div className="support-contact">
        <div className="support-contact-address">
          <span>{t('Prefer email?')}</span>
          <a
            href={emailLink(
              supportAddress,
              `[wya.im] ${t('Support')}: ${t(CONTACT_TOPICS[topic])}`,
            )}
            target="_blank"
            rel="noreferrer"
          >
            {supportAddress}
          </a>
        </div>
        <button type="button" className="support-copy" onClick={() => void copyAddress()}>
          <CopyIcon size={18} aria-hidden="true" />
          {t('Copy email')}
        </button>
        <p className="support-copy-status" role="status">
          {copyStatus ? t(copyStatus) : ''}
        </p>
      </div>

      <nav className="support-resources" aria-label={t('More ways to get help')}>
        <button type="button" onClick={onOpenHelp}>
          <QuestionIcon size={25} weight="duotone" aria-hidden="true" />
          <span>
            <strong>{t('Help guides')}</strong>
            <small>{t('Step-by-step help with your space.')}</small>
          </span>
        </button>
        <button type="button" onClick={onOpenBilling}>
          <CreditCardIcon size={25} weight="duotone" aria-hidden="true" />
          <span>
            <strong>{t('Plans & billing')}</strong>
            <small>{t('View your plan and manage your subscription.')}</small>
          </span>
        </button>
      </nav>
    </section>
  );
}
