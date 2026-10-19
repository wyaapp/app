import { SiteFooter } from './components/site-footer';
import Link from 'next/link';
import { Brand } from './components/brand';
export default function NotFound() {
  return (
    <div className="page-with-footer">
      <main className="not-found">
        <Brand />
        <p className="eyebrow">404 · NOT HERE, APPARENTLY</p>
        <h1>Where&apos;d it go?</h1>
        <p>That profile or link isn&apos;t available.</p>
        <Link className="button button-dark" href="/">
          Find your way home ↗
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
