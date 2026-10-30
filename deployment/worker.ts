import { routeAppRequest } from './app-routing';
import { prepareCloudflareRequest, secureResponse, apiResponse } from './request-boundary';

// Independent hosting must never trust caller-supplied Sites identity headers.
// Private routes verify independently signed sessions or scoped OAuth tokens.
const worker = {
  async scheduled(_event: ScheduledController, env: Cloudflare.Env) {
    const { dispatchDomainJobs, DOMAIN_MAINTENANCE_CRON } = await import('./domain-jobs');
    const { domainConfig } = await import('../lib/domains');
    const { createPictureService } = await import('../lib/picture-service');
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
    const { consumeDomainJobs } = await import('./domain-jobs');
    const { domainConfig } = await import('../lib/domains');
    await consumeDomainJobs(batch, env, domainConfig(env));
  },
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const app = await routeAppRequest(request, env.WYA_APP_ORIGIN, env.ASSETS);
    if (app) {
      const response = new Response(app.body, app);
      response.headers.set('X-Content-Type-Options', 'nosniff');
      return response;
    }
    const [
      { routeDomainRequest },
      { domainLookup },
      { resolveHostingMode },
      { routeProfileAvatar },
    ] = await Promise.all([
      import('./domain-routing'),
      import('../lib/custom-domains'),
      import('../lib/plans'),
      import('../lib/avatar.ts'),
    ]);
    const routed = await routeDomainRequest(
      request,
      env.WYA_ORIGIN ?? 'https://wya.im',
      env.DB ? domainLookup(env.DB, resolveHostingMode(env.WYA_HOSTING_MODE)) : async () => null,
      env.WYA_APP_ORIGIN,
    );
    if (routed instanceof Response) return secureResponse(request, routed);
    const avatar = await routeProfileAvatar(routed, env, ctx);
    if (avatar) return secureResponse(request, avatar);
    const prepared = prepareCloudflareRequest(
      routed,
      env.WYA_AUTH_MODE === 'email' && Boolean(env.BETTER_AUTH_SECRET && env.RESEND_API_KEY),
    );
    if (prepared instanceof Response) return secureResponse(request, prepared);
    const { default: handler } = await import('vinext/server/fetch-handler');
    const response = await handler.fetch(prepared, env, ctx);
    return secureResponse(request, apiResponse(request, response));
  },
};

export default worker;
