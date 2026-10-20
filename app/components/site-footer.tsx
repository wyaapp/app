'use client';
import { useTranslation } from '@/app/components/language-provider';
import { LanguageSwitcher } from './language-switcher';
import Link from 'next/link';
import { LegalLinks } from './legal-links';
import { FeedbackDialog } from './feedback-dialog';

export function SiteFooter({ feedback = false }: { feedback?: boolean }) {
  const { t } = useTranslation();
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-identity">
          <Link href="/" aria-label={t('wya.im home')}>
            wya.im
          </Link>
          <span>{t('Where you at? Right here.')}</span>
        </div>
        <div className="site-footer-links">
          <LanguageSwitcher />
          {feedback && <FeedbackDialog />}
          <a href="mailto:contact@wya.im">{t('Contact')}</a>
          <LegalLinks />
        </div>
      </div>
    </footer>
  );
}
