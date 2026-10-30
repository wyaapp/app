'use client';
import { useTranslation } from '@/app/components/language-provider';

export function LegalLinks() {
  const { t } = useTranslation();
  return (
    <nav className="legal-links" aria-label={t('Legal')}>
      <a href="https://wya.im/privacy">{t('Privacy Policy')}</a>
      <a href="https://wya.im/terms">{t('Terms of Use')}</a>
    </nav>
  );
}
