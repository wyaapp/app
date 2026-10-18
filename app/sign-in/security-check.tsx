'use client';
import { useEffect, useRef } from 'react';

type Turnstile = {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ): string;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let loading: Promise<void> | undefined;
function loadWidget() {
  if (window.turnstile) return Promise.resolve();
  if (!loading)
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        loading = undefined;
        reject(new Error('Security check unavailable.'));
      };
      document.head.appendChild(script);
    });
  return loading;
}
export function SecurityCheck({
  siteKey,
  attempt,
  onToken,
  onError,
}: {
  siteKey: string;
  attempt: number;
  onToken: (token: string) => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let id: string | undefined;
    void loadWidget()
      .then(() => {
        if (disposed || !container.current || !window.turnstile) return;
        id = window.turnstile.render(container.current, {
          sitekey: siteKey,
          action: 'login',
          callback: onToken,
          'expired-callback': () => onToken(''),
          'error-callback': () => {
            onToken('');
            onError('Security check failed. Please reload and try again.');
          },
        });
      })
      .catch(() => {
        if (!disposed) onError('Could not load the security check. Please reload and try again.');
      });
    return () => {
      disposed = true;
      if (id) window.turnstile?.remove(id);
    };
  }, [siteKey, attempt, onToken, onError]);
  return <div ref={container} aria-label="Sign-in security check" />;
}
