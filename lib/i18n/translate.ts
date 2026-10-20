import { ptBR } from './pt-BR.ts';
import type { Locale } from './locale.ts';
export type TranslationValues = Record<string, string | number>;
/** Translate only application copy. Never pass user-authored content to this function. */
export function createTranslator(locale: Locale) {
  return (message: string, values: TranslationValues = {}): string => {
    const template = locale === 'pt-BR' && Object.hasOwn(ptBR, message) ? ptBR[message] : message;
    return template.replace(/\{(\w+)\}/g, (match, key: string) =>
      Object.hasOwn(values, key) ? String(values[key]) : match,
    );
  };
}
