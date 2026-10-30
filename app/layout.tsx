import type { Metadata } from 'next';
import './globals.css';
import { ServerLanguageProvider } from './components/server-language-provider';
import { getLocale } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: {
      default: locale === 'pt-BR' ? 'wya.im — Cadê você?' : 'wya.im — Where you at?',
      template: '%s · wya.im',
    },
    description:
      locale === 'pt-BR'
        ? 'Um endereço para todos os seus lugares. Seus links e seu perfil, atualizados por conversa.'
        : 'One address for everywhere you are. Your links, your profile, managed through conversation.',
    icons: { icon: '/favicon.svg' },
  };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <ServerLanguageProvider initialLocale={locale}>{children}</ServerLanguageProvider>
      </body>
    </html>
  );
}
