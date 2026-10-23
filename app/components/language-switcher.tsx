'use client';
import { TranslateIcon } from '@phosphor-icons/react/dist/ssr/Translate';
import { isLocale } from '@/lib/i18n/locale';
import { useTranslation } from './language-provider';
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslation();
  return (
    <label className="language-switcher">
      <TranslateIcon weight="regular" size={16} aria-hidden="true" />
      <span className="sr-only">{t('Language')}</span>
      <select
        value={locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) setLocale(event.target.value);
        }}
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="pt-BR" lang="pt-BR">
          Português (Brasil)
        </option>
      </select>
    </label>
  );
}
