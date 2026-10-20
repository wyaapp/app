'use client';
import { useTranslation } from '@/app/components/language-provider';
import Link from 'next/link';

export function LegalLinks() {
  const { t } = useTranslation();
  return (
    <nav className="legal-links" aria-label={t('Legal')}>
      <Link href="/privacy">{t('Privacy Policy')}</Link>
      <Link href="/terms">{t('Terms of Use')}</Link>
    </nav>
  );
}
