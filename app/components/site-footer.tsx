'use client';
import { useTranslation } from '@/app/components/language-provider';
import { LanguageSwitcher } from './language-switcher';
import Link from 'next/link';
import { LegalLinks } from './legal-links';
import { FeedbackDialog } from './feedback-dialog';
import { siDiscord, siInstagram } from 'simple-icons';

const communityLinks = [
  { label: 'Join our Discord', href: 'https://wya.im/on/discord', icon: siDiscord },
  { label: 'Follow us on Instagram', href: 'https://wya.im/on/instagram', icon: siInstagram },
];

export function SiteFooter({ feedback = false }: { feedback?: boolean }) {
  const { t } = useTranslation();
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-about">
          <div className="site-footer-identity">
            <Link href="/" aria-label={t('wya.im home')}>
              wya.im
            </Link>
            <span>{t('Where you at? Right here.')}</span>
          </div>
          <nav className="site-footer-social" aria-label={t('Find us online')}>
            {communityLinks.map(({ label, href, icon }) => (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer">
                <svg
                  width={18}
                  height={18}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d={icon.path} />
                </svg>
                {t(label)}
              </a>
            ))}
          </nav>
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
