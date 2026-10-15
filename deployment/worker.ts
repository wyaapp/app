import handler from 'vinext/server/fetch-handler';
import { prepareCloudflareRequest } from './request-boundary';

// Independent hosting must never trust caller-supplied Sites identity headers.
// Replace this boundary with verified sessions and OAuth before public launch.
export default {
  fetch(request:Request, env:Cloudflare.Env, ctx:ExecutionContext) {
    const prepared = prepareCloudflareRequest(request);
    if(prepared instanceof Response) return prepared;
    return handler.fetch(prepared, env, ctx);
  },
};
