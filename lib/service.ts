import { createOnboardingService } from './onboarding-service';
import { env } from 'cloudflare:workers';
import { createSpaceService } from './space-service';

// Cloudflare bindings belong here; the service itself also runs in local tests.
function database() {
  if (!env.DB) throw new Error('Database is not configured.');
  return env.DB;
}

function service() {
  return createSpaceService(database());
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

export const getOnboarding = (userId: string) => createOnboardingService(database()).get(userId);
export const saveOnboarding = (userId: string, input: unknown) =>
  createOnboardingService(database()).save(userId, input);
