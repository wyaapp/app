import handler from 'vinext/server/fetch-handler';
import { prepareCloudflareRequest, secureResponse } from './request-boundary';
import { createPictureService } from '../lib/picture-service';
import { routeDomainRequest } from './domain-routing';
import { domainLookup } from '../lib/custom-domains';
import { domainConfig } from '../lib/domains';
import { resolveHostingMode } from '../lib/plans';
import { consumeDomainJobs, dispatchDomainJobs, DOMAIN_MAINTENANCE_CRON } from './domain-jobs';
import { routeProfileAvatar } from '../lib/avatar.ts';

// Independent hosting must never trust caller-supplied Sites identity headers.
// Private routes verify independently signed sessions or scoped OAuth tokens.
const worker = {
  async scheduled(_event: ScheduledController, env: Cloudflare.Env) {
    if (_event.cron === DOMAIN_MAINTENANCE_CRON) {
      await dispatchDomainJobs(env, domainConfig(env));
      return;
    }
    if (env.DB) {
      const now = Date.now();
      await env.DB.batch(
        ['security_limits', 'auth_mail_locks', 'auth_mail_limits'].map((table) =>
          env.DB!.prepare(`DELETE FROM ${table} WHERE expires_at < ?`).bind(now),
        ),
      );
    }
    if (env.DB && env.PICTURES) await createPictureService(env.DB, env.PICTURES).cleanup();
  },
  async queue(batch: MessageBatch<unknown>, env: Cloudflare.Env) {
    await consumeDomainJobs(batch, env, domainConfig(env));
  },
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const routed = await routeDomainRequest(
      request,
      env.WYA_ORIGIN ?? 'https://wya.im',
      env.DB ? domainLookup(env.DB, resolveHostingMode(env.WYA_HOSTING_MODE)) : async () => null,
    );
    if (routed instanceof Response) return secureResponse(request, routed);
    const avatar = await routeProfileAvatar(routed, env, ctx);
    if (avatar) return secureResponse(request, avatar);
    const prepared = prepareCloudflareRequest(
      routed,
      env.WYA_AUTH_MODE === 'email' && Boolean(env.BETTER_AUTH_SECRET && env.RESEND_API_KEY),
    );
    if (prepared instanceof Response) return secureResponse(request, prepared);
    return secureResponse(request, await handler.fetch(prepared, env, ctx));
  },
};

export default worker;
