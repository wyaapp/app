import handler from 'vinext/server/fetch-handler';
import { DOMAIN_HEADER } from '../lib/custom-domains';

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const headers = new Headers(request.headers);
    headers.delete(DOMAIN_HEADER);
    request = new Request(request, { headers });
    return handler.fetch(request, env, ctx);
  },
};
