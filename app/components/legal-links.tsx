import Link from 'next/link';

export function LegalLinks() {
  return (
    <nav className="legal-links" aria-label="Legal">
      <Link href="/privacy">Privacy Policy</Link>
      <Link href="/terms">Terms of Use</Link>
    </nav>
  );
}
