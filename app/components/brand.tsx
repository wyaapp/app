'use client';
import { useTranslation } from '@/app/components/language-provider';
import Link from 'next/link';
import { BrandSpark } from './brand-spark';
export function Brand() {
  const { t } = useTranslation();
  return (
    <Link href="/" className="brand" aria-label={t('wya.im home')}>
      wya<span className="brand-dot">.</span>im
      <span className="brand-spark">
        <BrandSpark />
      </span>
    </Link>
  );
}
