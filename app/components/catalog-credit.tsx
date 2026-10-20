'use client';
import { useTranslation } from '@/app/components/language-provider';
export function CatalogCredit() {
  const { t } = useTranslation();
  return (
    <p className="catalog-credit">
      {t('Game data by')}{' '}
      <a href="https://www.igdb.com" target="_blank" rel="noopener noreferrer">
        IGDB
      </a>
    </p>
  );
}
