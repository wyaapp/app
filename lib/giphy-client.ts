'use client';

import { GiphyFetch } from '@giphy/js-fetch-api';

let clientRequest: Promise<GiphyFetch | null> | undefined;

/** Share configuration and the official SDK across picker and image renderers. */
export function getGiphyClient(): Promise<GiphyFetch | null> {
  if (!clientRequest) {
    clientRequest = fetch('/api/gifs/config', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('GIF configuration is unavailable.');
        const config = (await response.json()) as { apiKey?: unknown };
        const key = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
        if (!key) {
          clientRequest = undefined;
          return null;
        }
        return new GiphyFetch(key);
      })
      .catch((error) => {
        clientRequest = undefined;
        throw error;
      });
  }
  return clientRequest;
}
