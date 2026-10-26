import handler from 'vinext/server/fetch-handler';
import { DOMAIN_HEADER } from '../lib/custom-domains';
import { routeProfileAvatar } from '../lib/avatar.ts';

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const headers = new Headers(request.headers);
    headers.delete(DOMAIN_HEADER);
    request = new Request(request, { headers });
    const avatar = await routeProfileAvatar(request, env, ctx);
    if (avatar) return avatar;
    return handler.fetch(request, env, ctx);
  },
};
