import type { ReactNode } from 'react';
import Link from 'next/link';
import { Brand } from './brand';
import { LegalLinks } from './legal-links';

export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <Brand />
        <Link className="text-link" href="/">
          Back to Wya
        </Link>
      </header>
      <main id="main-content" className="legal-document">
        <div className="eyebrow">WYA.IM</div>
        <h1>{title}</h1>
        <p className="legal-intro">{intro}</p>
        <aside className="legal-draft" aria-label="Draft status">
          <strong>Draft for review — not yet effective</strong>
          <p>
            Prepared October 18, 2026. The remaining legal and retention details need review before
            publication.
          </p>
        </aside>
        {children}
      </main>
      <footer className="legal-footer">
        <span>Where you at? Right here.</span>
        <LegalLinks />
      </footer>
    </div>
  );
}
