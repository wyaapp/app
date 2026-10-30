'use client';
import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from 'react';
import { localeCookie, type Locale } from '@/lib/i18n/locale';
import { createTranslator } from '@/lib/i18n/translate';
const LanguageContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: ReturnType<typeof createTranslator>;
}>({
  locale: 'en' as Locale,
  setLocale: () => {},
  t: createTranslator('en'),
});
export function LanguageProvider({
  initialLocale,
  children,
  onLocaleChange,
}: {
  initialLocale: Locale;
  children: ReactNode;
  onLocaleChange?: () => void;
}) {
  const [locale, setLanguage] = useState(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo(
    () => ({
      locale,
      t: createTranslator(locale),
      setLocale: (next: Locale) => {
        document.cookie = `${localeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
        setLanguage(next);
        onLocaleChange?.();
      },
    }),
    [locale, onLocaleChange],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useTranslation() {
  return useContext(LanguageContext);
}
