import Link from 'next/link';
import { BrandSpark } from './brand-spark';
export function Brand(){return <Link href="/" className="brand" aria-label="wya.im home">wya<span className="brand-dot">.</span>im<span className="brand-spark"><BrandSpark/></span></Link>}
