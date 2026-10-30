'use client';
import { useTranslation } from '@/app/components/language-provider';
import { BrandSpark } from './brand-spark';
export function Brand({ href = '/' }: { href?: string }) {
  const { t } = useTranslation();
  return (
    <a href={href} className="brand" aria-label={t('wya.im home')}>
      wya<span className="brand-dot">.</span>im
      <span className="brand-spark">
        <BrandSpark />
      </span>
    </a>
  );
}
