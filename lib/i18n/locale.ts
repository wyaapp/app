export const locales = ['en', 'pt-BR'] as const;
export type Locale = (typeof locales)[number];
export const localeCookie = 'wya-locale';
export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'pt-BR';
}

/** Explicit preference wins; otherwise follow the browser's language priorities. */
export function resolveLocale(preference?: string | null, acceptLanguage = ''): Locale {
  if (isLocale(preference)) return preference;
  const languages = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag, ...parameters] = part.trim().toLowerCase().split(';');
      const weight = parameters.find((parameter) => parameter.trim().startsWith('q='));
      const quality = weight ? Number(weight.trim().slice(2)) : 1;
      return { tag, quality, index };
    })
    .filter(({ quality }) => Number.isFinite(quality) && quality > 0 && quality <= 1)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of languages) {
    if (tag === 'pt' || tag === 'pt-br' || tag.startsWith('pt-')) return 'pt-BR';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return 'en';
}
