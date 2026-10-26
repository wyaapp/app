import { createOnboardingService } from './onboarding-service';
import { env } from 'cloudflare:workers';
import { createSpaceService } from './space-service';
import { activeDomainForSpace, domainLookup, domainIsActive } from './custom-domains';
import type { Profile } from './profile-types';
import { createAccountPlanService } from './account-plan-service';
import { resolveHostingMode } from './plans';

async function withDomain(profile: Profile | null) {
  if (!profile) return null;
  const domain = await activeDomainForSpace(
    database(),
    profile.id,
    resolveHostingMode(env.WYA_HOSTING_MODE),
  );
  return {
    ...profile,
    publicDomain: domain
      ? { hostname: domain.hostname, redirect: Boolean(domain.redirect) }
      : undefined,
  };
}

// Cloudflare bindings belong here; the service itself also runs in local tests.
function database() {
  if (!env.DB) throw new Error('Database is not configured.');
  return env.DB;
}

function service() {
  return createSpaceService(database(), Date.now, resolveHostingMode(env.WYA_HOSTING_MODE));
}

export const getAccountPlan = (userId: string) =>
  createAccountPlanService(database(), resolveHostingMode(env.WYA_HOSTING_MODE)).get(userId);
export const listSpaces = (userId: string) => service().listSpaces(userId);
export const getAccount = async (userId: string, spaceId?: string) =>
  withDomain(await service().getAccount(userId, spaceId));
export const getPublicProfile = async (handle: string) =>
  withDomain(await service().getPublicProfile(handle));
// Redirects use the compiled link index; document parsing is only needed for page rendering.
export const getRedirectProfile = async (handle: string) =>
  withDomain(await service().getPublicProfile(handle, false));
export const getRedirectProfileByDomain = async (hostname: string) => {
  const domain = await domainLookup(database(), resolveHostingMode(env.WYA_HOSTING_MODE))(hostname);
  return domain && domainIsActive(domain) ? getRedirectProfile(domain.handle) : null;
};
export const getPublicProfileByDomain = async (hostname: string) => {
  const domain = await domainLookup(database(), resolveHostingMode(env.WYA_HOSTING_MODE))(hostname);
  return domain && domainIsActive(domain) ? getPublicProfile(domain.handle) : null;
};
export const getHistory = (userId: string, spaceId?: string) =>
  service().getHistory(userId, spaceId);
export const checkHandle = (userId: string, handle: string, spaceId?: string) =>
  service().checkHandle(userId, handle, spaceId);
export const mutate = async (userId: string, input: unknown) =>
  (await withDomain(await service().mutate(userId, input)))!;

export const getOnboarding = (userId: string) => createOnboardingService(database()).get(userId);
export const saveOnboarding = (userId: string, input: unknown) =>
  createOnboardingService(database()).save(userId, input);
