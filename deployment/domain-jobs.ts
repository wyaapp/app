import { createDomainService } from '../lib/domain-service.ts';
import { domainsConfigured, type DomainConfig } from '../lib/domain-provider.ts';
import { consumeDomainMaintenance, dispatchDomainMaintenance } from '../lib/domain-maintenance.ts';

export const DOMAIN_MAINTENANCE_CRON = '*/5 * * * *';

/** Logs contain aggregate health only, never domain names, ownership tokens or provider bodies. */
export async function dispatchDomainJobs(env: Cloudflare.Env, config: DomainConfig) {
  if (!domainsConfigured(config)) return;
  if (!env.DB || !env.DOMAIN_MAINTENANCE)
    throw new Error('Custom-domain maintenance requires the database and queue bindings.');
  const metrics = await dispatchDomainMaintenance(env.DB, env.DOMAIN_MAINTENANCE);
  console.info(JSON.stringify({ event: 'domain-maintenance-dispatch', ...metrics }));
  if (metrics.sendFailures)
    throw new Error('Domain maintenance enqueue failed; unqueued work remains due.');
}

export async function consumeDomainJobs(
  batch: MessageBatch<unknown>,
  env: Cloudflare.Env,
  config: DomainConfig,
) {
  // Throwing retains/retries the delivery when a release accidentally loses configuration.
  if (!env.DB || !domainsConfigured(config))
    throw new Error('Custom-domain maintenance is not configured.');
  const service = createDomainService(env.DB, config);
  const metrics = await consumeDomainMaintenance(batch, service.processMaintenance);
  console.info(JSON.stringify({ event: 'domain-maintenance-consume', ...metrics }));
}
