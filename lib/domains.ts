import { env } from 'cloudflare:workers';
import { createDomainService } from './domain-service';

export function domainConfig(bindings: Cloudflare.Env = env) {
  return {
    zoneId: bindings.CUSTOM_DOMAINS_ZONE_ID,
    token: bindings.CUSTOM_DOMAINS_API_TOKEN,
    target: bindings.CUSTOM_DOMAINS_TARGET,
    origin: bindings.WYA_ORIGIN,
  };
}
export function domains() {
  if (!env.DB) throw new Error('Database is not configured.');
  return createDomainService(env.DB, domainConfig());
}
