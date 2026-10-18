import { env } from 'cloudflare:workers';
import Link from 'next/link';
import { Brand } from '../components/brand';
import SignInForm from './sign-in-form';
import { LegalLinks } from '../components/legal-links';
export default function SignInPage() {
  return (
    <main className="auth-shell">
      <Brand />
      <section className="auth-card">
        <div className="eyebrow">YOUR LITTLE CORNER OF THE INTERNET</div>
        <h1>Oh, there you are.</h1>
        <p>Sign in or create your account with an email code. No password to remember.</p>
        <SignInForm siteKey={env.TURNSTILE_SITE_KEY || ''} />
        <div className="auth-legal">
          <p>Read how Wya works and handles your information.</p>
          <LegalLinks />
        </div>
        <Link className="text-link" href="/">
          Back to wya.im
        </Link>
      </section>
    </main>
  );
}
