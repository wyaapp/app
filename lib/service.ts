import { env } from 'cloudflare:workers';
import { createSpaceService } from './space-service';

// Cloudflare bindings belong here; the service itself also runs in local tests.
function service() {
  if (!env.DB) throw new Error('Database is not configured.');
  return createSpaceService(env.DB);
}

export const listSpaces = (userId: string) => service().listSpaces(userId);
export const getAccount = (userId: string, spaceId?: string) =>
  service().getAccount(userId, spaceId);
export const getPublicProfile = (handle: string) => service().getPublicProfile(handle);
export const getHistory = (userId: string, spaceId?: string) =>
  service().getHistory(userId, spaceId);
export const checkHandle = (userId: string, handle: string, spaceId?: string) =>
  service().checkHandle(userId, handle, spaceId);
export const mutate = (userId: string, input: unknown) => service().mutate(userId, input);
