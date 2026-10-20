import { cookies, headers } from 'next/headers';
import { localeCookie, resolveLocale } from './locale';
import { createTranslator } from './translate';
export async function getLocale() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(
    cookieStore.get(localeCookie)?.value,
    headerStore.get('accept-language') ?? '',
  );
}
export async function getTranslator() {
  return createTranslator(await getLocale());
}
