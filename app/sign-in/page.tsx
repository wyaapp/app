import { getTranslator } from '@/lib/i18n/server';
import { LanguageSwitcher } from '../components/language-switcher';
import { SiteFooter } from '../components/site-footer';
import { env } from 'cloudflare:workers';
import Link from 'next/link';
import { Brand } from '../components/brand';
import SignInForm from './sign-in-form';
import { LegalLinks } from '../components/legal-links';
export default async function SignInPage() {
  const t = await getTranslator();
  return (
    <div className="page-with-footer">
      <main className="auth-shell">
        <Brand />
        <LanguageSwitcher />
        <section className="auth-card">
          <div className="eyebrow">{t('YOUR LITTLE CORNER OF THE INTERNET')}</div>
          <h1>{t('Oh, there you are.')}</h1>
          <p>{t('Sign in or create your account with an email code. No password to remember.')}</p>
          <SignInForm siteKey={env.TURNSTILE_SITE_KEY || ''} />
          <div className="auth-legal">
            <p>{t('Read how Wya works and handles your information.')}</p>
            <LegalLinks />
          </div>
          <Link className="text-link" href="/">
            {t('Back to wya.im')}
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
