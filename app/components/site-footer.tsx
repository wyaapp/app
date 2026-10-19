import Link from 'next/link';
import { LegalLinks } from './legal-links';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-identity">
          <Link href="/" aria-label="wya.im home">
            wya.im
          </Link>
          <span>Where you at? Right here.</span>
        </div>
        <div className="site-footer-links">
          <a href="mailto:contact@wya.im">Contact</a>
          <LegalLinks />
        </div>
      </div>
    </footer>
  );
}
