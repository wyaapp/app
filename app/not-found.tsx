import { getTranslator } from '@/lib/i18n/server';
import { SiteFooter } from './components/site-footer';
import Link from 'next/link';
import { Brand } from './components/brand';
export default async function NotFound() {
  const t = await getTranslator();
  return (
    <div className="page-with-footer">
      <main className="not-found">
        <Brand />
        <p className="eyebrow">{t('404 · NOT HERE, APPARENTLY')}</p>
        <h1>{t("Where'd it go?")}</h1>
        <p>{t("That profile or link isn't available.")}</p>
        <Link className="button button-dark" href="/">
          {t('Find your way home ↗')}
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
