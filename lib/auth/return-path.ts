export function safeReturnPath(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/dashboard';
  try {
    const url = new URL(value, 'https://wya.im');
    if (url.origin !== 'https://wya.im' || /^\/(?:api|sign-in|sign-out|signin-with-chatgpt|signout-with-chatgpt)(?:\/|$)/.test(url.pathname)) return '/dashboard';
    return url.pathname + url.search;
  } catch { return '/dashboard'; }
}
