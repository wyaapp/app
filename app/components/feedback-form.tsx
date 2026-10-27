'use client';

import { useId } from 'react';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/ssr/PaperPlaneTilt';
import { reportRetryClock } from '@/lib/report-retry';
import { REPORT_MESSAGE_MIN, REPORT_MESSAGE_MAX } from '@/lib/report-schema';
import type { useReportForm } from './use-report-form';
import { useTranslation } from './language-provider';

export function FeedbackForm({
  feedback,
  onDone,
}: {
  feedback: ReturnType<typeof useReportForm>;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { message, setMessage, busy, sent, reference, error, retrySeconds, reset, submit } =
    feedback;

  if (sent)
    return (
      <div className="feedback-result" role="status">
        <CheckIcon weight="regular" size={24} aria-hidden="true" />
        <p>{t('Thanks! Your feedback has been sent.')}</p>
        {reference && (
          <p className="subtle">
            {t('Reference')}: <code>{reference}</code>
          </p>
        )}
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
        minLength={REPORT_MESSAGE_MIN}
        maxLength={REPORT_MESSAGE_MAX}
        required
        disabled={busy}
        aria-describedby={`${id}-notice ${id}-count${error ? ` ${id}-error` : ''}${retrySeconds ? ` ${id}-retry` : ''}`}
      />
      <p id={`${id}-notice`} className="subtle">
        {t(
          'Your name, email, account ID and selected space details are sent with your message to our team on Discord.',
        )}
      </p>
      {error && (
        <p id={`${id}-error`} role="alert">
          {t(error)}
        </p>
      )}
      {retrySeconds > 0 && (
        <p id={`${id}-retry`} className="subtle" role="timer" aria-live="off">
          {t('Try again in {time}. Your message is still here.', {
            time: reportRetryClock(retrySeconds),
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
          disabled={busy || retrySeconds > 0 || message.trim().length < REPORT_MESSAGE_MIN}
        >
          {busy ? t('Sending...') : t('Send feedback')}{' '}
          <PaperPlaneTiltIcon weight="regular" aria-hidden="true" size={16} />
        </button>
      </div>
    </form>
  );
}
