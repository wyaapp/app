'use client';
import { useRouter } from 'next/navigation';
import { LanguageProvider } from './language-provider';
import type { Locale } from '@/lib/i18n/locale';
import type { ReactNode } from 'react';
export function ServerLanguageProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <LanguageProvider initialLocale={initialLocale} onLocaleChange={() => router.refresh()}>
      {children}
    </LanguageProvider>
  );
}
