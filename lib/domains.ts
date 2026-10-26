import { env } from 'cloudflare:workers';
import { createDomainService } from './domain-service';
import { resolveHostingMode } from './plans';

export function domainConfig(bindings: Cloudflare.Env = env) {
  return {
    zoneId: bindings.CUSTOM_DOMAINS_ZONE_ID,
    token: bindings.CUSTOM_DOMAINS_API_TOKEN,
    target: bindings.CUSTOM_DOMAINS_TARGET,
    origin: bindings.WYA_ORIGIN,
    hostingMode: resolveHostingMode(bindings.WYA_HOSTING_MODE),
  };
}
export function domains() {
  if (!env.DB) throw new Error('Database is not configured.');
  return createDomainService(env.DB, domainConfig());
}
