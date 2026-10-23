'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useRef, useState, type FormEvent } from 'react';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import {
  occupationOptions,
  purposeOptions,
  discoveryOptions,
  type Onboarding,
  type OnboardingAnswers,
} from '@/lib/onboarding';

export function OnboardingForm({
  initial,
  onSaved,
  settings = false,
  disabled = false,
}: {
  initial: Onboarding | null;
  onSaved: (value: Onboarding) => void;
  settings?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    occupation: initial?.occupation ?? null,
    purpose: initial?.purpose ?? null,
    discovery: initial?.discovery ?? null,
  });
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save(input: Record<string, unknown>) {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const response = await fetch('/api/account/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const result = (await response.json()) as { onboarding: Onboarding; error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not save your answers.');
      if (input.action === 'skip') {
        setAnswers({ occupation: null, purpose: null, discovery: null });
      }
      onSaved(result.onboarding);
      setSaved(true);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not save your answers. Please try again.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save({ action: 'complete', ...answers });
  }

  return (
    <form className="onboarding-form" onSubmit={submit} aria-busy={busy}>
      <p className="subtle">
        {t(
          'Tell us a little about yourself to help us decide what to build next. Every question is optional.',
        )}
        <span className="onboarding-privacy">{t('Your answers stay private.')}</span>
      </p>
      <fieldset className="onboarding-questions" disabled={busy || disabled}>
        <legend className="sr-only">{t('Optional questions about you')}</legend>
        {(
          [
            ['occupation', 'What do you do?', occupationOptions],
            ['purpose', 'Why are you here?', purposeOptions],
            ['discovery', 'How did you find us?', discoveryOptions],
          ] as const
        ).map(([name, question, options]) => (
          <fieldset key={name} className="onboarding-question">
            <legend>{t(question)}</legend>
            <div className="onboarding-choices">
              {Object.entries(options).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="onboarding-choice"
                  aria-pressed={answers[name] === value}
                  onClick={() => {
                    const next = {
                      ...answers,
                      [name]: answers[name] === value ? null : value,
                    };
                    setAnswers(next);
                    setSaved(false);
                  }}
                >
                  <CheckIcon weight="regular" size={14} aria-hidden="true" />
                  {t(label === 'Search' ? 'Search engine' : label)}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </fieldset>
      {error && (
        <div className="message error" role="alert">
          <p>{t(error)}</p>
          {!settings && (
            <button
              type="button"
              className="button button-light button-small"
              onClick={() =>
                onSaved({ status: 'skipped', occupation: null, purpose: null, discovery: null })
              }
            >
              {t('Continue without saving')}
            </button>
          )}
        </div>
      )}
      {saved && settings && <p role="status">{t('Answers saved.')}</p>}
      <div className="onboarding-actions">
        <button type="submit" className="button button-dark" disabled={busy || disabled}>
          {busy ? t('Saving...') : settings ? t('Save answers') : t('Continue')}
        </button>
        <button
          type="button"
          className="text-link"
          disabled={busy || disabled}
          onClick={() => void save({ action: 'skip' })}
        >
          {settings ? t('Clear answers') : t('Skip')}
        </button>
      </div>
    </form>
  );
}
