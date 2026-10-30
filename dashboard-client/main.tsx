import { createRoot } from 'react-dom/client';
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { LanguageProvider, useTranslation } from '@/app/components/language-provider';
import { LanguageSwitcher } from '@/app/components/language-switcher';
import { Brand } from '@/app/components/brand';
import { LegalLinks } from '@/app/components/legal-links';
import { resolveLocale, localeCookie } from '@/lib/i18n/locale';
import { parseDashboardRoute } from '@/lib/dashboard-routes';
import { DashboardBootstrap } from '@/app/dashboard/bootstrap';
import '@/app/globals.css';
import '@/app/dashboard/dashboard.css';

const SignInForm = lazy(() => import('@/app/sign-in/sign-in-form'));
const SignOut = lazy(() => import('@/app/sign-out/page'));

function SignIn() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<{ siteKey: string; localSignIn: string | null } | null>(
    null,
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/app-config', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Configuration unavailable');
        setConfig(await response.json());
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);
  return (
    <main className="auth-shell">
      <Brand href="https://wya.im" />
      <LanguageSwitcher />
      <section className="auth-card">
        <h1>{t('Oh, there you are.')}</h1>
        <p>{t('Sign in or create your account with an email code. No password to remember.')}</p>
        {error ? (
          <p role="alert">{t('Sign-in is temporarily unavailable. Please try again later.')}</p>
        ) : !config ? (
          <p role="status">{t('Loading…')}</p>
        ) : config.localSignIn ? (
          <a className="button" href={config.localSignIn}>
            {t('Sign in')}
          </a>
        ) : (
          <SignInForm siteKey={config.siteKey} />
        )}
        <LegalLinks />
      </section>
    </main>
  );
}

class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="auth-shell" role="alert">
        <h1>Could not open the dashboard.</h1>
        <button className="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}

function App() {
  const url = new URL(window.location.href);
  if (url.pathname === '/sign-in') return <SignIn />;
  if (url.pathname === '/sign-out') return <SignOut />;
  const route = url.pathname === '/' ? { section: 'files' as const } : parseDashboardRoute(url);
  if (!route)
    return (
      <main className="auth-shell">
        <h1>Page not found</h1>
        <a href="/">Dashboard</a>
      </main>
    );
  return <DashboardBootstrap section={route.section} spaceId={route.spaceId} />;
}

const preference = document.cookie
  .split(';')
  .map((value) => value.trim())
  .find((value) => value.startsWith(`${localeCookie}=`))
  ?.split('=')[1];
createRoot(document.getElementById('root')!).render(
  <LanguageProvider initialLocale={resolveLocale(preference, navigator.languages.join(','))}>
    <AppBoundary>
      <Suspense
        fallback={
          <main className="auth-shell" role="status">
            Loading…
          </main>
        }
      >
        <App />
      </Suspense>
    </AppBoundary>
  </LanguageProvider>,
);
