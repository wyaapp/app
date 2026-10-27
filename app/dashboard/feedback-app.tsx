'use client';

import { useId } from 'react';
import { ChatTeardropDotsIcon } from '@phosphor-icons/react/dist/ssr/ChatTeardropDots';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { useTranslation } from '../components/language-provider';
import { FeedbackForm } from '../components/feedback-form';
import { useReportForm } from '../components/use-report-form';

export function FeedbackApp({
  spaceId,
  onOpenSupport,
}: {
  spaceId?: string;
  onOpenSupport: () => void;
}) {
  const { t } = useTranslation();
  const heading = useId();
  const feedback = useReportForm({ endpoint: '/api/feedback', spaceId });

  return (
    <section className="editor-panel feedback-app" aria-labelledby={heading}>
      <header className="feedback-app-heading">
        <ChatTeardropDotsIcon weight="duotone" size={24} aria-hidden="true" />
        <h2 id={heading}>{t('What could be better?')}</h2>
      </header>
      <p className="feedback-app-intro">{t('Found a bug or have an idea? Tell us.')}</p>
      <FeedbackForm feedback={feedback} />
      <footer className="feedback-app-support window-section-divider">
        <p>{t('Need help with your account?')}</p>
        <button type="button" className="text-link" onClick={onOpenSupport}>
          {t('Open Support')}
          <ArrowRightIcon size={16} aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
}
