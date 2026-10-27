import type { DomainSettings } from './custom-domains.ts';

export type DomainAction = {
  action: 'connect' | 'check' | 'redirect' | 'remove';
  hostname?: string;
  redirect?: boolean;
};

export type DomainSettingsRequest = (
  input?: DomainAction,
  signal?: AbortSignal,
) => Promise<DomainSettings>;

export function createDomainSettingsRequest(spaceId: string): DomainSettingsRequest {
  const endpoint = `/api/domains?spaceId=${encodeURIComponent(spaceId)}`;
  return async (input, signal) => {
    const response = await fetch(endpoint, {
      signal,
      ...(input
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          }
        : {}),
    });
    const data = (await response.json()) as DomainSettings & { error?: string };
    if (!response.ok)
      throw new Error(
        data.error ||
          (input
            ? 'Could not update domain settings. Please try again.'
            : 'Could not load domain settings.'),
      );
    return data;
  };
}
