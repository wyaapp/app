import Link from 'next/link';
import { Brand } from './components/brand';
export default function NotFound(){return <main className="not-found"><Brand/><p className="eyebrow">404 · NOT HERE, APPARENTLY</p><h1>Where’d it go?</h1><p>That profile or link isn’t available.</p><Link className="button button-dark" href="/">Find your way home ↗</Link></main>}
